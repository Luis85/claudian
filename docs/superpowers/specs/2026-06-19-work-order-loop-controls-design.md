---
type: design
title: "Work-Order Loop Controls: Completion Oracles, Budgets & Verifiers on the Agent Board"
date: 2026-06-19
status: draft
scope: agents
tags:
  - design
  - work-orders
  - agent-board
  - loops
  - loop-engineering
related:
  - "[[docs/research/2026-06-19-loop-engineering-fit]]"
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
  - "[[docs/superpowers/specs/2026-06-19-tool-and-skill-library-design]]"
  - "[[docs/superpowers/specs/2026-06-04-work-order-execution-design]]"
  - "[[docs/superpowers/specs/2026-05-28-agent-board-thin-slice-design]]"
  - "[[docs/superpowers/specs/2026-05-29-work-order-templates-design]]"
---

# Work-Order Loop Controls: Completion Oracles, Budgets & Verifiers

## Status & decisions

- **Direction (user-confirmed):** fold loop engineering into the **Agent Board
  and its Work-Orders** rather than introducing a new top-level "Loop" concept.
  Loops are **properties of a Work-Order** (a bounded, verifiable run) and of the
  **roster Agents** that execute and verify them.
- Grounding research:
  [`2026-06-19-loop-engineering-fit`](../../research/2026-06-19-loop-engineering-fit.md).
  The load-bearing lesson: *a loop converges only when grounded in external truth
  (tests/tools/judge/human) and bounded by externally-enforced stops; never let
  the model self-judge completion.* "The verifier is the bottleneck, not the
  model."
- This is a design spec, not an implementation plan. It extends the existing
  Work-Order model (`src/features/tasks/model/taskTypes.ts`), run coordinator
  (`TaskRunCoordinator` / `RunSession`), and Agent Board UI.

## What a Work-Order becomes

Today a Work-Order is a prompt + prose acceptance criteria executed as a single
run, where a human moves the card to `done`. We make the **run a first-class,
bounded verification loop** by adding three orthogonal, separately-configurable
concerns — exactly the split the framework research found prevents runaway cost:

1. **Budgets** — externally-enforced safety stops (turns / cost / wall-clock).
2. **Completion oracle** — the success stop: *what counts as done*, ideally a
   verifiable check rather than the agent's own say-so.
3. **Verifier** — *who/what* judges completion (a programmatic tool, a test
   command, or a roster Agent acting as judge).

Recurrence (scheduled re-runs) is deliberately **out of scope here** and deferred
to the remote-trigger/automations work (see research §6).

---

## Data model changes

### Work-Order frontmatter (`TaskFrontmatter`)

Additive, all optional, so existing notes keep parsing. (Bump `schema_version`
to `2` with a tolerant reader; absent fields = today's behavior.)

```typescript
export interface TaskFrontmatter {
  // …existing fields (type, id, title, status, priority, agent?, provider?, …)…

  // — Budgets (safety stops; terminate on whichever fires first) —
  max_turns?: number | null;        // agent tool-use turns; maps to provider maxTurns/max_iter
  max_cost_usd?: number | null;     // spend ceiling; maps to Claude maxBudgetUsd
  max_runtime_sec?: number | null;  // wall-clock; maps to CrewAI max_execution_time

  // — Completion oracle (success stop) —
  done_when?: CompletionOracle;     // absent = { kind: 'manual' } (today's behavior)

  // — Loop bookkeeping (written by the run) —
  stop_reason?: TaskStopReason | null;
  verify_attempts?: number;         // how many verification rounds this run took
}

export type TaskStopReason =
  | 'completed'      // oracle passed
  | 'max_turns'
  | 'max_cost'
  | 'max_runtime'
  | 'no_progress'    // oscillation / repeat detected (Phase 3)
  | 'error'          // crashed mid-execution
  | 'canceled';

export type CompletionOracle =
  | { kind: 'manual' }                                   // human moves card to done (default)
  | { kind: 'command'; command: string; passExitZero?: boolean } // e.g. `npm test`
  | { kind: 'tool'; toolId: string; expect?: unknown }  // a Claudian Tool-Library tool returns pass
  | { kind: 'judge'; verifierAgentId: string; threshold?: number }; // a roster Agent scores vs acceptanceCriteria
```

`TaskSections.acceptanceCriteria` (prose) stays and becomes the **rubric** fed to
a `judge` oracle, and the human-readable spec for `manual`. A `command`/`tool`
oracle is the verifiable ideal; `judge` is the LLM-as-signal fallback.

### Terminal/loop states (reuse lanes, decorate with `stop_reason`)

We do **not** expand the `TaskStatus` enum (it drives board lanes). Instead
`stop_reason` decorates existing statuses so the board can distinguish outcomes:

| Outcome | `status` | `stop_reason` | Resumable? | Board affordance |
|---|---|---|---|---|
| Oracle passed | `done` (or `review` if `manual`) | `completed` | — | — |
| Budget hit, work incomplete | `needs_fix` | `max_turns`/`max_cost`/`max_runtime` | yes | **"Resume (raise budget)"** |
| No progress detected | `needs_fix` | `no_progress` | yes | "Resume" / "Edit & retry" |
| Crash | `failed` | `error` | via existing retry | "Retry" |
| Oracle failed after budget | `needs_fix` | budget reason | yes | "Resume" + verifier output |

This mirrors Claude's `ResultMessage.subtype` set (`success` /
`error_max_turns` / `error_max_budget_usd` / `error_during_execution`) onto the
board's existing lanes. (Open question: whether a dedicated `budget_exceeded`
lane is worth the enum churn — recommend not, initially.)

### Roster Agent — a verifier role

Extend `RosterAgent` (from the roster spec) so an Agent can serve as a
completion-oracle judge:

```typescript
export interface RosterAgent {
  // …existing (id, name, description, prompt, tools, skills, …)…
  roles?: Array<'worker' | 'verifier'>;   // default ['worker']; 'verifier' = selectable as a judge
  defaultBudgets?: { maxTurns?: number; maxCostUsd?: number; maxRuntimeSec?: number };
}
```

A `judge` oracle's `verifierAgentId` must reference an Agent whose `roles`
include `verifier`. Verifier Agents are projected and run exactly like workers
(provider-agnostic per the roster spec) — they just receive the rubric + the
worker's output and return a pass/score.

### Work-Order Template

`WorkOrderTemplate` (templates spec) carries loop defaults so a template
*is* a reusable loop definition (Devin-playbook analogue):

```typescript
export interface WorkOrderTemplate {
  // …existing (name, description, provider?, model?, priority?, body)…
  defaultAgentId?: string;        // (from roster spec)
  doneWhen?: CompletionOracle;    // default completion oracle
  budgets?: { maxTurns?: number; maxCostUsd?: number; maxRuntimeSec?: number };
}
```

---

## Run behaviour: the verification loop

`TaskRunCoordinator` / `RunSession` gain budget enforcement and an oracle pass.
The loop (LangChain loop #2, "verification loop") layered over the existing run:

```
start run (existing) ──► agent works (existing provider loop, bounded by budgets)
        │                         │
        │            budget hit ──┴──► set needs_fix + stop_reason (resumable)  ──► settle
        │
   agent reaches natural stop (says "done")
        │
   evaluate completion oracle ────────────────────────────────────────────────┐
        │ manual  → status review (human decides)            ──► settle         │
        │ command → run cmd; exit 0?                                            │
        │ tool    → invoke Tool-Library tool; pass?                             │
        │ judge   → verifier Agent scores vs acceptanceCriteria ≥ threshold?    │
        ▼                                                                       │
     pass ► status done, stop_reason completed ──► settle                       │
     fail ► inject oracle feedback as next turn, verify_attempts++ ─────────────┘
            (re-enters the agent loop, still bounded by budgets)
```

- **Budget enforcement.** Map to provider-native controls where they exist
  (Claude `maxTurns`/`maxBudgetUsd`); otherwise `RunSession` counts turns and
  enforces wall-clock. Terminate on first axis breached; write `stop_reason`.
- **Oracle is external truth.** `command`/`tool` are deterministic checks
  (preferred). `judge` uses a verifier Agent and is treated as a *signal* — it
  still respects budgets so a never-satisfied judge can't loop forever.
- **Feedback injection.** On oracle failure, the failing check's output (test
  log, tool result, or judge critique) is appended as the next user turn — this
  is what makes it a *verification loop*, not a one-shot. Bounded by budgets and
  a `maxVerifyAttempts` (default small, e.g. 3).
- **Ledger captures loop data.** Each oracle evaluation and each tool call is
  already a `TaskLedgerEntry`; we additionally record `(tool, args)` hashes so
  **no-progress detection** (exact-repeat / oscillation) can be added in Phase 3
  without schema change. The `.claudian/runs/<runId>/ledger.jsonl` substrate is
  unchanged.
- **Resume.** Budget/no-progress stops are resumable: "Resume (raise budget)"
  re-enters with a higher ceiling, restoring context from the existing
  session/resume path. Human-in-the-loop stays **pause-not-exit** (the existing
  `needs_input`/`needs_approval` resume flow already does this).

## Agent Board & modal surfacing

- **Card (live strip):** when budgets are set, show usage (e.g. `turns 6/20`,
  `$0.12/$1.00`) on `running` cards; show a small **"done when"** chip (✓ tests /
  🔧 tool / ⚖️ verifier / 👤 manual); on stop, show a `stop_reason` badge with
  the matching primary action ("Resume (raise budget)" for budget stops).
  Patch-in-place via the existing `patchLiveStrip`/`patchCard`.
- **WorkOrderDetailModal → properties panel:** add an editable **Loop** section —
  the completion-oracle picker (manual / command / tool / verifier-agent), the
  three budget fields, and `verify_attempts`/`stop_reason` (read-only) alongside
  the existing status/agent/provider/model chips.
- **Activity section:** the verifier's pass/fail output and each verification
  round render in the existing activity block (reuse the handoff/ledger card).
- **Template editor:** expose the same Loop defaults so a template seeds them.

## Integration with the other specs

- **Roster spec:** add `roles` + `defaultBudgets` to `RosterAgent`; the Agent
  detail view gains a "Can act as verifier" toggle. A Work-Order assigned an
  Agent inherits that Agent's `defaultBudgets` unless overridden.
- **Tool/Skill Library spec:** a user **Tool is the ideal programmatic oracle** —
  the `tool` completion-oracle invokes a Tool-Library tool whose `CallToolResult`
  is asserted (e.g. a `tests_pass` or `lint_clean` tool). This closes the loop:
  user-authored checks become the work-order's verifier. No new mechanism.
- **Work-order execution design (2026-06-04):** this extends, not replaces, that
  run model; the sidecar heartbeat/ledger split and terminal snapshot are
  unchanged.

## Phasing

- **Phase 1 — Budgets + terminal `stop_reason`.** Add the three budget fields,
  enforce them in `RunSession` (provider-native where available), write
  `stop_reason`, and surface usage + a "Resume (raise budget)" action on the
  board. Pure safety win; no oracle yet. Highest value / lowest risk.
- **Phase 2 — Completion oracle (verification loop).** `done_when` with
  `manual`/`command`/`tool`/`judge`, feedback injection bounded by
  `maxVerifyAttempts`, verifier role on roster Agents, modal + template editors.
  This is the core loop-engineering payoff (verifiable acceptance).
- **Phase 3 — No-progress detection.** Exact-repeat (`(tool,args)` hash) and
  semantic oscillation guards over the ledger; auto-stop with
  `stop_reason: 'no_progress'`. (Data already recorded in Phase 1–2.)
- **Deferred — Recurrence/automations** (scheduled re-runs, cron + TTL +
  circuit-breaker) and the **hill-climbing** loop (improve an Agent from its run
  history) — separate later work per the research.

## Conflicts & resolutions

| Concern | Resolution |
|---|---|
| Status-enum churn for budget stops | Decorate existing lanes with `stop_reason`; no new statuses initially. |
| Model self-judging completion | Default `manual`; verifiable `command`/`tool` preferred; `judge` is budget-bounded and treated as a signal. |
| Judge never satisfied → infinite loop | Budgets + `maxVerifyAttempts` cap; failure routes to `needs_fix` (resumable). |
| Cross-provider budget parity | Map to provider-native controls (Claude `maxTurns`/`maxBudgetUsd`); fall back to coordinator-enforced turn/wall-clock counting. |
| Schema migration | `schema_version: 2` tolerant reader; all new fields optional. |

## Decisions still needing the user
1. **Oracle surface in the board UI:** a simple radio ("done when: a human says
   so / a command passes / a tool returns true / a verifier agent approves") vs.
   keeping `command`/`tool`/`judge` in an "advanced" disclosure. *Recommend:
   simple radio, advanced details inline.*
2. **Default budgets:** ship sensible defaults (e.g. `max_cost_usd` per run) on
   new Work-Orders, or leave unset (today's unbounded behavior) until the user
   opts in? *Recommend: a conservative default cost ceiling, editable.*
3. **Dedicated `budget_exceeded` lane** vs. reusing `needs_fix` + `stop_reason`.
   *Recommend: reuse `needs_fix` initially.*
