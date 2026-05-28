---
type: claudian-issue
id: issue-20260528-agent-board-mvp
title: Agent Board MVP — Markdown work orders with visible sidepanel execution
status: open
priority: high
triage: ready-for-agent
created: 2026-05-28
updated: 2026-05-28
owner: Claudian
source: "[[docs/ideas/agent-board-symphony.md]]"
scope: phase-1-mvp
tags:
  - agent-board
  - tasks
  - prd
---

# Agent Board MVP — Markdown work orders with visible sidepanel execution

> Source idea: [[docs/ideas/agent-board-symphony.md]]
> Scope: Phase 1 (MVP) only. Phases 2–5 are out of scope for this PRD.

## Problem Statement

I keep my specs, plans, decisions, and working memory as Markdown in my Obsidian vault, then I jump into a chat sidepanel to actually get an agent to do the work. The two worlds don't connect. Once a chat run starts, the durable intent (goal, acceptance criteria, linked context, scope) is trapped in a long transcript that scrolls away, and the result never comes back into my vault as something reviewable. When I run more than one piece of work I lose track of what is in flight, what is waiting on me, and what is finished. I have no single place that answers "what work have I delegated to an agent, what state is it in, and can I trust the result?"

## Solution

Claudian turns the vault itself into the control plane for agent work. A **work order** is a plain Markdown note with YAML frontmatter that owns the goal, acceptance criteria, linked context, scope, permissions, and run metadata. A new **Agent Board** view renders those notes as a status board grouped by lane. I create a work order, click **Run**, and Claudian binds it to a sidepanel chat tab that streams the run using the existing chat UI I already trust. As the run progresses Claudian writes a concise ledger and final handoff back into the note's generated regions, so the durable result lives in my vault. If Claudian is ever uninstalled, the work orders remain ordinary, readable, queryable Markdown notes.

Positioning: **Plan in Markdown. Run in worktrees. Review with evidence.** — MVP delivers the "plan in Markdown" and "run visibly" halves; worktrees and rich evidence land in later phases.

## User Stories

### Capture
1. As a vault-native developer, I want to create an agent work order from a command palette action, so that I can delegate work without leaving Obsidian.
2. As a developer, I want to create a work order from the current note, so that I can turn an existing spec or idea into delegated work in one step.
3. As a developer, I want to create a work order from selected editor text, so that a snippet of context becomes the seed of a task.
4. As a developer, I want to create a work order from a browser selection, so that captured web content can scope a task.
5. As a developer, I want to create a work order from an existing chat message, so that a useful agent exchange becomes a durable, trackable work item.
6. As a developer, I want to create a work order that references files or folders, so that the agent knows the repository scope up front.
7. As a developer, I want new work orders to land in a configurable folder (default `Agent Board/tasks/`), so that they stay organized and out of my way.
8. As a developer, I want a new work order pre-filled with valid frontmatter and a body template (Objective, Acceptance Criteria, Context, Constraints, Run Ledger, Result/Handoff), so that I can fill in intent quickly without remembering the schema.

### Board
9. As a developer, I want a dedicated Agent Board view, so that I can see all my delegated work in one place.
10. As a developer, I want cards grouped by frontmatter `status` into lanes (Inbox, Ready, Running, Needs Input, Needs Approval, Review, Needs Fix, Done, Failed, Canceled), so that I understand the operational state at a glance.
11. As a developer, I want each card to show title, provider/model, current status, priority, and linked conversation, so that I can identify and triage work quickly.
12. As a developer, I want each card to show the latest ledger event and heartbeat age, so that I can tell whether a run is alive, idle, or stalled.
13. As a developer, I want a pending approval/input indicator on cards, so that I know which runs are blocked waiting on me.
14. As a developer, I want to open the underlying note from a card, so that I can read or edit full intent and context.
15. As a developer, I want the board to refresh when work-order notes change on disk, so that the board reflects reality without a manual reload.
16. As a developer, I want corrupted or invalid work-order frontmatter to be skipped safely and surfaced as an error rather than crashing the board, so that one bad note doesn't break the view.

### Execution
17. As a developer, I want a **Run** action on a card, so that I can start an agent run for that work order on demand.
18. As a developer, I want a **Run next ready** action, so that I can kick off the next eligible work order without picking one manually.
19. As a developer, I want Claudian to validate frontmatter and workflow configuration before running, so that I don't start a malformed run.
20. As a developer, I want the run to open or reuse a sidepanel chat tab bound to the work order, so that execution happens in the streaming UI I already trust.
21. As a developer, I want the agent prompt rendered from the work-order note (and workflow template when present), so that the run reflects my stated intent and constraints.
22. As a developer, I want the existing renderers to show text, tool calls, diffs, todo state, plan approval, and ask-user prompts during the run, so that I keep full visibility and control.
23. As a developer, I want exactly one active run per work order, so that a task can't fork into competing concurrent runs.
24. As a developer, I want to **Stop** a running work order, so that I can cancel a run that is going wrong.
25. As a developer, I want to **Retry** a failed or canceled work order manually, so that I can re-run after fixing context.
26. As a developer, I want the conversation ID and run ID persisted in the work order's frontmatter, so that the note stays linked to its execution history across reloads.

### Status & ledger
27. As a developer, I want Claudian to advance the work order through a validated status lifecycle as the run progresses, so that the board lane always reflects the true state.
28. As a developer, I want a concise run ledger written into a generated region of the note, so that I can read a months-later-useful timeline without wading through a transcript.
29. As a developer, I want Claudian to own only the generated ledger region and status/run fields, leaving the rest of the note user-owned, so that my own writing is never overwritten.
30. As a developer, I want frontmatter updates to use a safe compare-and-swap / lock strategy, so that the orchestrator never clobbers edits I made while a run was active.

### Review & handoff
31. As a developer, I want a final handoff section written back to the note (summary of what changed, branch, verification notes, remaining risks, next suggested action), so that I get a durable, reviewable result in my vault.
32. As a developer, I want to move a work order to Review, Done, or Canceled from the board, so that I can record the human verdict.
33. As a developer, I want a `needs_fix` lane so a reviewed-but-rejected task can route back to development, so that rework stays visible instead of silently reopening.

### Reliability & safety
34. As a developer, I want a work order to be skipped (not crash the board) if its frontmatter is unparseable, so that the system degrades gracefully.
35. As a developer, I want a run to survive a plugin reload — reconnecting or marking the run state honestly — so that I don't lose track of in-flight work.
36. As a developer, I want closing the sidepanel tab mid-run to be handled cleanly (run state recorded, no orphaned lock), so that the board stays trustworthy.
37. As a developer, I want write actions to default to the task's own status/log fields only, with shell/network/commit gated to "ask", so that running a work order can't silently mutate my repo or vault.
38. As a developer, I want publishing (push/PR) excluded from MVP entirely, so that no run can change a remote without me.

## Implementation Decisions

Use the vocabulary from the source idea note throughout: **work order** (a Markdown task note), **Agent Board** (the status view), **lane** (a status grouping), **run ledger** (the generated timeline region), **handoff** (the durable result), **execution surface** (the seam between scheduling and provider runtime).

### New feature module: `features/tasks`
A new feature module owns work-order indexing, board UI, manual run coordination, prompt rendering, run ledgers, and task-note updates. It must **not** parse Codex JSON-RPC or provider-native transcripts directly. All provider behavior stays behind `ChatRuntime`, `ProviderRegistry`, and provider history services (confirmed present at `src/core/runtime/ChatRuntime.ts` and `src/core/providers/ProviderRegistry.ts`).

### Deep modules (simple, stable, isolation-testable interfaces)

- **`TaskNoteStore`** — the single read/write boundary for work-order notes. Parses frontmatter into a typed `TaskSpec`, writes back only orchestrator-owned fields (status, run/conversation IDs, run metadata), and updates the generated run-ledger region by marker, never touching user-authored prose. Compare-and-swap / lock semantics protect against overwriting concurrent human edits. This is the deepest module: a small surface (`read`, `writeStatus`, `appendLedger`, `writeHandoff`) hiding all the Markdown/YAML and generated-region mechanics.

- **`TaskStateMachine`** — pure transition logic over the MVP lifecycle: `inbox → ready → running → {needs_input, needs_approval} → review → {needs_fix → ready, done} | failed | canceled`. Validates whether a transition is legal and is the only authority on next-state. No I/O. `needs_fix` is the review-rejection state that routes back toward development.

- **`TaskExecutionSurface`** — narrow seam introduced immediately so headless mode can be a later adapter without coupling run coordination to tabs. Interface (from the idea note prototype, the decision-encoding shape):
  ```ts
  interface TaskExecutionSurface {
    startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle>;
  }
  ```
  MVP ships exactly one adapter: **`ChatTabExecutionSurface`**, which reuses `TabManager`, `InputController`, `StreamController`, and the existing renderers (`MessageRenderer`, `ToolCallRenderer`, `WriteEditRenderer`, `InlinePlanApproval`, `InlineAskUserQuestion` — all confirmed present under `src/features/chat/`). `HeadlessExecutionSurface` is explicitly out of scope.

- **`WorkflowNoteStore`** — parses optional workflow notes and renders the run prompt from work-order fields plus the workflow template. Rendering is **strict**: unknown variables or filters fail validation rather than rendering blanks. Invalid workflow reloads keep the last known-good workflow and surface an operator-visible error. For MVP a built-in default template is used when no workflow note exists.

### Supporting modules (thinner, MVP-level)
- **`TaskIndexer`** — watches the configured folder, builds the in-memory board model from `TaskNoteStore` reads, and emits change events to the view. Skips unparseable notes and records them as errored rather than throwing.
- **`TaskRunCoordinator`** — orchestrates a single manual run: validate → acquire single-run ownership → call the execution surface → drive `TaskStateMachine` transitions from stream/lifecycle signals → write ledger and handoff via `TaskNoteStore`. Owns the "one run per work order" invariant.
- **`AgentBoardView` / `AgentBoardRenderer` / `TaskCard`** — register `VIEW_TYPE_CLAUDIAN_AGENT_BOARD`, render lanes and cards, and wire card actions (Open, Run, Stop, Retry, Mark review/done/canceled).
- **`TaskRunLedger`** — formats concise ledger entries (`timestamp — status — message`) for `TaskNoteStore` to write into the generated region.
- **`taskCommands`** — command-palette entries for create-work-order (from note/selection/browser/chat/context), Run, and Run next ready.

### Data contract
- Work-order frontmatter follows the `type: claudian-work-order`, `schema_version: 1` shape from the idea note, but MVP only reads/writes the subset it needs: `id`, `title`, `status`, `priority`, `provider`, `model`, `agent`, `mode`, `context`, `permissions`, and the `execution` block (`run_id`, `conversation_id`, `sidepanel_tab_id`, `started`, `finished`, `attempts`). Unused frontmatter (worktree, full evidence/result blocks) is preserved verbatim on write but not driven by MVP.
- MVP status set: `inbox, ready, running, needs_input, needs_approval, review, needs_fix, done, failed, canceled`. Later additions (`scheduled, retry_scheduled, stalled, blocked`) are out of scope.
- Generated regions are delimited by explicit markers (`<!-- claudian:run-ledger-start -->` / `<!-- claudian:run-ledger-end -->`). Everything outside markers is user-owned.

### Boundary & safety decisions
- One running work order owns one run ID, one conversation, one sidepanel tab.
- Effective permissions come from settings + per-run approval, never self-granted by the note's YAML. MVP posture: auto-run off; file writes limited to the task's own status/log fields; shell/network/commit gated to "ask"; push/PR excluded.
- Secrets are deny-by-default: never inject `.env*`, credential files, provider configs, or private keys into prompts/logs.
- `features/tasks` writes vault internals (`.obsidian/`, `.claude/`, `.codex/`, `.claudian/`, `.git/`) only through owned APIs, never as agent free-write.

## Testing Decisions

A good test verifies **external behavior through the module's public interface**, not its internals. Tests assert on inputs and observable outputs (returned values, written note content, emitted state), never on private methods or call ordering. Tests mirror `src/` under `tests/unit/` and `tests/integration/` per project convention; use the `itPosix`/`itWin32` helpers for path-sensitive cases.

Modules to test (all four selected for TDD):

- **`TaskNoteStore`** (unit) — frontmatter parse round-trips; writing status/run fields preserves unrelated frontmatter and body prose verbatim; run-ledger appends land only inside markers; generated-region writes are idempotent and never touch user content; compare-and-swap rejects/merges a write when the note changed underneath. Prior art: existing storage/serialization tests under `tests/unit/` (Claude MCP storage, session metadata).
- **`TaskStateMachine`** (unit) — every legal transition accepted, every illegal transition rejected; `review → needs_fix` and `needs_fix → ready` round-trip; terminal states (`done`, `canceled`, `failed`) reject further transitions. Pure-function tests, no fixtures.
- **`TaskExecutionSurface` / `ChatTabExecutionSurface`** (contract) — drive the adapter with a **fake `ChatRuntime`** that emits text chunks, tool use/result chunks, write/edit chunks, approval requests, ask-user requests, plan-completed metadata, cancellation, provider error, and resumed-session metadata; assert the coordinator advances task status and writes ledger entries correctly for each. Prior art: existing runtime/stream tests that already exercise `StreamChunk` shapes.
- **`WorkflowNoteStore`** (unit) — workflow note parse; strict prompt rendering succeeds with all variables present and **fails loudly** on an unknown variable/filter; invalid workflow keeps last known-good and reports an error.

Integration tests (a representative subset for MVP): note → eligible task → manual run → review state; sidepanel tab closed mid-run; plugin reload during a running task; user edits note during a run; corrupted frontmatter skipped safely; successful run persists conversation/run IDs.

## Out of Scope

- Autonomous background daemon, cron-like scheduler, retry scheduling beyond manual retry.
- Multi-agent concurrency pool; dependency DAGs; recursive task spawning.
- `GitWorktreeWorkspaceAllocator` and worktree allocation (Phase 2). MVP runs in the current vault/repo context.
- Evidence bundles, changed-file attribution, `unknown`/`conflicted` indicators, leases/stale-run detection (Phase 2).
- `claudian.agent-board.rules/v1` YAML policy packs, WIP limits, Review Guard automation, full workflow language (Phase 3).
- `HeadlessExecutionSurface` and background execution (Phase 4).
- GitHub/Linear sync, PR creation/push automation, playbook learning, multi-run comparison (Phase 5).
- Any auto-push / auto-PR / auto-merge; dependency installation without approval; agent-controlled permission or MCP/plugin changes.

## Further Notes

- This PRD intentionally covers **Phase 1 only**. The full multi-phase vision lives in [[docs/ideas/agent-board-symphony.md]]; the `TaskExecutionSurface` seam and the frontmatter/status superset are built now specifically so later phases attach as adapters and fields rather than rewrites.
- The product test for MVP: *Can I create a Markdown work order, run it through Claudian, watch it live, and get a durable result back in Obsidian?*
- Open validation questions (naming "Agent Board" vs alternatives, default permission tier, primary-artifact shape) are tracked in the idea note and do not block MVP build.
- No ADRs currently exist (`docs/adr/` absent). If MVP locks in a long-term boundary (e.g. the execution-surface seam), record an ADR at that point.
