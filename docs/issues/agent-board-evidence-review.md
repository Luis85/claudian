---
type: prd
id: issue-20260529-agent-board-evidence-review
title: Agent Board Evidence & Review Gate — structured run evidence, changed-file attribution, run leases, and evidence-gated completion
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-05-29
updated: 2026-05-29
owner: Claudian
source: "[[agent-board-symphony]]"
related:
  - "[[agent-board-mvp]]"
  - "[[2026-05-28-standalone-product-vision]]"
  - "[[2026-06-07-agent-board-redesign-plan]]"
scope: phase-2-richer-evidence-before-worktrees
tags:
  - agent-board
  - evidence
  - review-gate
  - attribution
  - leases
  - prd
  - specorator-transition
relations:
  - "[[Agent Kanban Board]]"
---

# Agent Board Evidence & Review Gate — structured run evidence, changed-file attribution, run leases, and evidence-gated completion

> Source idea: [[agent-board-symphony]] (Phase 2 — "Safer workspaces and richer evidence")
> Builds on: [[agent-board-mvp]] (Phase 1 MVP, landing now)
> Transition context: [[2026-05-28-standalone-product-vision]]
> Scope: the increment immediately after the Agent Board MVP. This PRD takes the **richer evidence + review trust** half of symphony Phase 2 and explicitly **defers git worktrees** to a following increment.

## PRD review summary

The Agent Board MVP proved the loop: create a Markdown work order, run it visibly in a sidepanel chat tab, and get a run ledger plus a prose handoff back in the vault. The MVP run, however, is trust-thin. The handoff is free prose the agent writes about itself; nothing is verified, nothing tells me which files actually changed or whether a human edited the note mid-run, and nothing stops me from marking a task `done` with no proof. One-run-per-work-order is only enforced in memory, so a plugin reload can strand or double a run.

This increment makes the result **reviewable with evidence** while staying in the current repo. It is scoped around four product constraints:

1. **No chat regression and no MVP run regression.** Direct chat stays first-class. The existing MVP run path (Run → visible sidepanel → ledger + handoff) keeps working; evidence and the review gate are additive.
2. **Evidence is structured and durable.** The agent reports verification results and changed files in a structured, parseable block; Claudian writes a typed evidence bundle into a generated region of the note. The note stays readable Markdown if the plugin is removed.
3. **Review is gated, not decorative.** A work order does not leave `review` for `done` unless the lane's required evidence is present, with an explicit, recorded override as the only escape hatch.
4. **Runs are honest across reloads.** A durable run lease enforces one run per work order and lets the board show whether a run is alive, idle, or stale — even for manual runs.

Verification is **agent-reported and structured** for this increment: Claudian parses and validates the structure of what the agent reports, but does not itself execute verification commands. Claudian-run verification is called out as a deliberate later upgrade.

## Problem Statement

I can already create a work order, run it, and watch it stream. But when the run ends I cannot trust the result. The handoff is a paragraph the agent wrote about its own work — there is no per-acceptance-criterion verification, no list of which files it actually changed, and no signal if I edited the note while it was running. I can move the card to `done` with literally no proof of work. When I run several work orders I cannot tell which are alive, which are idle, and which silently died when I reloaded the plugin, because "one active run" only lives in memory. The board shows status, but not trust.

## Solution

Claudian adds a **run evidence** layer and an **evidence-gated review** step to the Agent Board, plus a durable **run lease** for honest run state.

When a run finishes, the agent emits a structured evidence block alongside its prose handoff. Claudian parses it into a typed **evidence bundle** — changed files, per-criterion verification results with command and exit status, optional commit/PR references, artifacts, caveats, and remaining risks — and writes it into a dedicated generated region of the work-order note. Claudian also reconciles the agent-reported changed files against the repository working tree using git status, and marks each file as **attributed**, **unknown**, or **conflicted** so ambiguous or human-touched changes are never silently presented as agent work.

The board surfaces this trust state on each card: how many files changed, whether required evidence is missing, whether the run is waiting on me (approval/input), and how long since the last heartbeat. Moving a work order from `review` to `done` is gated by the lane's **definition of done**, expressed as machine-checkable required-evidence keys. If evidence is missing or a verification failed, the natural route is `needs_fix`; accepting anyway requires an explicit override that is recorded in the run ledger.

A durable run lease replaces the in-memory one-run guard, so the board can detect stale runs and survive a plugin reload without losing track of in-flight work. Writes back to the note use compare-and-swap so a human edit during a run is never clobbered.

Positioning for this increment: **Plan in Markdown. Run visibly. Review with evidence — for real.**

## Product guardrails

### Direct chat and MVP runs do not regress

- Direct chat sidepanel behavior is unchanged and does not depend on evidence, attribution, leases, or the review gate.
- The MVP run path keeps working. A work order with no structured evidence block in its output still completes — it lands in `review` with an empty/incomplete evidence bundle and a clearly-flagged "no evidence reported" state, never a crash.
- Evidence parsing, attribution, leases, and the review gate are additive layers behind the existing `TaskExecutionSurface` seam; they do not parse provider JSON-RPC or transcripts directly.

### Evidence is honest

- Verification is agent-reported in this increment. Claudian validates structure and completeness, not truth of execution; the UI labels results as agent-reported.
- Changed-file attribution prefers honesty over confidence: `unknown` and `conflicted` are shown explicitly rather than assumed to be agent work.
- The review gate blocks `review → done` when required evidence is absent. The only bypass is an explicit override that records a justification in the ledger and (optionally) routes to `needs_fix`.

### Runs stay in the current repo this increment

- No worktree isolation yet — runs operate on the current working tree, exactly as the MVP does. Attribution, compare-and-swap note writes, and the review gate are the trust controls for this increment.
- Worktree isolation is the explicit next increment; this PRD must not foreclose it. The workspace seam stays clean so `GitWorktreeWorkspaceAllocator` can slot in later.

## User Stories

### Non-regression (chat and MVP run)

1. As a user, I want to keep using direct chat with no work order, so that the evidence/review work never makes lightweight use heavier.
2. As a user, I want existing chat actions (send, stream, cancel, resume, fork, history, attachments, inline edit, skills/subagents, provider settings) to keep working without evidence/lease/board state, so that nothing regresses.
3. As a developer, I want an MVP-style run that produces no structured evidence to still complete into `review`, so that older work orders and simple runs are never broken by the new layer.
4. As a developer, I want a run with no evidence to be clearly marked "no evidence reported" rather than silently treated as complete, so that absence of proof is visible.

### Evidence capture

5. As a developer, I want the agent to report changed files in a structured block (path, change type, committed or not), so that I see what the run actually touched.
6. As a developer, I want the agent to report per-acceptance-criterion verification (criterion, command run, exit status, notes), so that "it works" is backed by named checks.
7. As a developer, I want the agent to report optional commit/branch/PR references and artifact links, so that durable outputs are linked from the note.
8. As a developer, I want the agent to report caveats, skipped checks, and remaining risks, so that I know what was not done.
9. As a developer, I want Claudian to parse this into a typed evidence bundle and write it into a dedicated generated region of the note, so that evidence is durable, readable Markdown.
10. As a developer, I want the evidence region to be owned solely by the orchestrator and delimited by explicit markers, so that my own prose is never overwritten.
11. As a developer, I want malformed or partial evidence to degrade to an "incomplete evidence" state instead of crashing the run or the board, so that the system stays robust.
12. As a developer, I want the run prompt to tell the agent exactly which evidence the current lane requires, so that the agent reports what review will check for.

### Changed-file attribution

13. As a developer, I want Claudian to reconcile reported changed files against the repository working tree, so that the evidence reflects reality, not just the agent's claims.
14. As a developer, I want each changed file marked `attributed`, `unknown`, or `conflicted`, so that ambiguous changes are not presented as confident agent work.
15. As a developer, I want a file that changed during the run with no agent attribution signal marked `unknown`, so that I can investigate rather than trust blindly.
16. As a developer, I want a file edited by both the agent and me (or modified after the agent wrote it) marked `conflicted`, so that mid-run human edits are surfaced.
17. As a developer, I want the changed-file count and any unknown/conflicted warnings shown on the card, so that I can triage trust at a glance.

### Review gate and completion

18. As a developer, I want each lane's definition of done expressed as machine-checkable required-evidence keys, so that "done" has an objective meaning.
19. As a developer, I want Claudian to compute evidence completeness against the lane's required evidence, so that I see exactly what is present and what is missing.
20. As a developer, I want `review → done` blocked when required evidence is missing or a verification failed, so that I cannot accidentally accept unproven work.
21. As a developer, I want a work order with missing evidence or failed verification to route naturally to `needs_fix`, so that rework stays visible.
22. As a developer, I want an explicit "Accept anyway" override that records a justification in the ledger, so that I can override the gate deliberately and auditably.
23. As a developer, I want the card and detail pane to show which evidence items are missing before I try to accept, so that I know what to fix first.

### Run leases and stale-run detection

24. As a developer, I want one active run per work order enforced by a durable lease, not just in-memory state, so that a plugin reload cannot create competing runs.
25. As a developer, I want the run to heartbeat while it is active, so that the board can tell alive from idle from stalled.
26. As a developer, I want a run whose heartbeat has aged past a configurable timeout shown as stale, so that I notice dead runs.
27. As a developer, I want a plugin reload during a run to reconcile the lease honestly — reconnect if the tab still exists, or mark the run state truthfully if it does not — so that I never lose track of in-flight work.
28. As a developer, I want closing the sidepanel tab mid-run to release the lease cleanly and record the outcome, so that no orphaned lock remains.
29. As a developer, I want the heartbeat/lease state stored in Claudian-owned state rather than churned into note frontmatter, so that frequent run updates do not fight my edits.

### Board observability

30. As a developer, I want each card to show a pending approval/input indicator while a run waits on me, so that I know which runs are blocked.
31. As a developer, I want each card to show heartbeat age and a stale flag, so that I can spot dead runs.
32. As a developer, I want each card to show changed-file count and a missing-evidence badge, so that I can prioritize review.
33. As a developer, I want the detail pane to show the full evidence bundle — changed files with attribution badges, verification results, references, caveats, and risks — so that I can review without reading the transcript.
34. As a developer, I want the detail pane's accept action disabled or clearly gated when required evidence is missing, so that the gate is obvious in the UI.

### Reliability and safety

35. As a developer, I want note writes during a run to use compare-and-swap, so that my mid-run edits are merged or rejected, never clobbered.
36. As a developer, I want evidence-region writes to be idempotent and confined to their markers, so that re-running or re-writing never corrupts the note.
37. As a developer, I want corrupted evidence/attribution data to be skipped and surfaced as an error on the card rather than crashing the board, so that one bad run does not break the view.
38. As a developer, I want the run to keep the MVP permission posture (writes ask-gated, push/PR excluded, secrets deny-by-default), so that richer evidence does not loosen safety.

## Implementation Decisions

Vocabulary continues from the source idea and the MVP PRD: **direct chat**, **work order**, **Agent Board**, **lane**, **definition of ready/done**, **role**, **run ledger**, **handoff**, **execution surface**. This increment adds: **run evidence / evidence bundle** (typed structured proof-of-work), **changed-file attribution** (`attributed | unknown | conflicted`), **review gate** (evidence-completeness check on `review → done`), and **run lease** (durable one-run-per-order ownership with heartbeat/stale detection).

### Boundary continuity

All provider behavior stays behind `ChatRuntime`, `ProviderRegistry`, existing chat controllers/renderers, and provider history services. `features/tasks` keeps owning indexing, board UI, run coordination, prompt rendering, ledgers, evidence, attribution, leases, and note writes. Attribution reads git only through the existing read-only git service seam; it does not introduce new git mutation. The single MVP execution adapter (`ChatTabExecutionSurface`) remains the only execution surface; this increment widens the *signals* that surface forwards, not the set of adapters.

### Deep modules (simple, stable, isolation-testable interfaces)

- **`RunEvidenceParser`** (pure) — parses the agent's structured evidence block from final run output into a typed `RunEvidence`. Extends, and composes with, the existing handoff parser: the prose handoff (summary / verification narrative / risks / next action) stays as-is; the evidence block is the new machine-checkable artifact. Parsing is tolerant: missing or malformed sections produce an `incomplete` bundle with recorded reasons, never a throw. Unknown fields are ignored, not fatal. Pure function, no I/O.

  Evidence shape produced by the parser (from scoping; trim to decision-relevant fields):
  ```ts
  type FileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

  interface ChangedFileReport { path: string; change: FileChangeKind; committed: boolean; }

  interface VerificationResult {
    criterion: string;        // acceptance-criterion label/ref, or free label
    command?: string;         // what the agent says it ran
    status: 'passed' | 'failed' | 'skipped';
    notes?: string;
  }

  interface RunEvidence {
    changedFiles: ChangedFileReport[];
    verification: VerificationResult[];
    references: { branch?: string; commit?: string; pr?: string; artifacts: string[] };
    caveats: string;
    risks: string;
    completeness: 'complete' | 'incomplete' | 'none';
    parseErrors: string[];    // why incomplete, if so
  }
  ```

- **`EvidenceCompletenessEvaluator`** (the review gate; pure) — given a `RunEvidence` and a lane's required-evidence keys, returns whether the evidence is complete, the satisfied keys, and the missing keys, plus whether any reported verification `failed`. The coordinator and UI consume this; it is the single authority on "is this evidence enough for this lane." Pure function, no I/O.
  ```ts
  type EvidenceKey =
    | 'changed_files'
    | 'acceptance_criteria_verification'
    | 'verification_commands'
    | 'commit_ref'
    | 'artifacts';

  interface ReviewGateResult {
    complete: boolean;          // all required keys satisfied AND no failed verification
    satisfied: EvidenceKey[];
    missing: EvidenceKey[];
    hasFailedVerification: boolean;
  }
  ```
  Gate policy: `review → done` is allowed only when `complete` is true. When it is not, the affordance offers route-to-`needs_fix` or an explicit override. Override is not silent — it appends a ledger entry recording the override and a justification string.

- **`ChangedFileAttributor`** — splits into a **pure fold** plus a **thin reader**. The fold is the deep, tested part: given a git working-tree snapshot at run start, a snapshot at run end, the set of files the agent reported/touched during the run, and the set of files observed changing outside agent activity during the run window, it classifies each changed file as `attributed | unknown | conflicted`. The reader is a thin wrapper over the existing read-only git status service that produces the snapshots; it adds no git mutation.
  ```ts
  type FileAttribution = 'attributed' | 'unknown' | 'conflicted';

  interface AttributedFile { path: string; change: FileChangeKind; attribution: FileAttribution; }

  // pure
  function foldFileAttribution(input: {
    before: GitFileState[];          // working-tree snapshot at run start
    after: GitFileState[];           // working-tree snapshot at run end
    agentTouched: ReadonlySet<string>;
    externalEdits: ReadonlySet<string>; // changed during run window without agent signal
  }): AttributedFile[];
  ```
  Rules: changed during the run window AND only agent-touched → `attributed`; changed with no agent signal → `unknown`; touched by both agent and an external edit, or modified after the agent's last write → `conflicted`. `unknown`/`conflicted` are first-class display states, never coerced to `attributed`.

- **`TaskLeaseManager`** — owns durable one-run-per-work-order ownership and stale detection, replacing the MVP in-memory `Set`. `acquire(taskId, runId)` fails if a live lease is held; `heartbeat(taskId)` refreshes `lastHeartbeat`; `isStale(now)` is true when `now - lastHeartbeat > staleTimeoutMs`; `release(taskId)` clears the lease. Lease records live in Claudian-owned state (`.claudian/tasks/<task-id>/`), not in note frontmatter, to avoid YAML write churn fighting human edits. Expiry/stale math is pure and tested; persistence is a thin store. On plugin reload the coordinator reconciles: live lease + existing tab → reconnect; live lease + missing tab → record honest terminal/blocked state in the ledger and release.
  ```ts
  interface TaskLease { taskId: string; runId: string; startedAt: string; lastHeartbeat: string; }
  ```

### Modules extended (not new)

- **`TaskNoteStore`** — gains a third generated region for evidence, and **compare-and-swap** on write. CAS compares an on-disk content hash captured when the run read the note against the current hash before writing; on mismatch it re-locates generated regions by marker and rewrites only orchestrator-owned regions/fields, never user prose, or rejects and surfaces a conflict. Evidence-region writes are idempotent and marker-confined. New generated region:
  ```md
  <!-- claudian:evidence-start -->
  <!-- claudian:evidence-end -->
  ```
  Frontmatter gains only compact, durable fields — `evidence_status: complete | incomplete | none` and an optional `review_verdict` — never the full bundle or the heartbeat. The structured bundle lives in the evidence region as readable Markdown; high-frequency run state (heartbeat, lease) lives in `.claudian/tasks/<task-id>/`.

- **`TaskExecutionSurface` / `ChatTabExecutionSurface`** — the seam widens from "return a final handle" to "also forward lifecycle signals during the run." An optional `onEvent` callback in the run options receives a small, provider-neutral event union the adapter derives from existing stream/renderer signals it already handles — it does not parse provider JSON-RPC. The coordinator subscribes to drive heartbeats, status, and the agent-touched file set.
  ```ts
  type TaskRunEvent =
    | { kind: 'activity' }                         // heartbeat tick
    | { kind: 'tool-activity'; paths?: string[] }  // feeds agentTouched for attribution
    | { kind: 'approval-pending' }                 // -> needs_approval
    | { kind: 'ask-user-pending' }                 // -> needs_input
    | { kind: 'resumed' }
    | { kind: 'canceled' }
    | { kind: 'error'; message: string };
  ```

- **`TaskRunCoordinator`** — run sequence becomes: acquire lease → start run via surface (passing the lane's required-evidence into the rendered prompt) → on each event, heartbeat the lease and reflect approval/input status, accumulating agent-touched files → on completion, snapshot git, parse evidence, fold attribution, write the evidence region and `evidence_status`, evaluate the review gate, and transition (default to `review`) → release lease. Failure/cancel/stale paths release the lease and record an honest ledger entry.

- **`TaskPromptRenderer`** — injects the current lane's required-evidence keys and definition-of-done text, and instructs the agent to emit the structured evidence block with exactly those items. Rendering stays the built-in template (no `WorkflowNoteStore` this increment); strict failure on unknown variables is preserved.

- **Board config (`BoardConfigStore` / lane config)** — each lane gains `requiredEvidence: EvidenceKey[]` alongside the existing free-text definition-of-done. Free text remains human guidance; the keys are what the gate checks. A configurable `staleRunTimeoutMs` is added (board config or plugin settings). Invalid config still falls back to last-known-good/default and surfaces a board-visible error; required-evidence keys validate against the known `EvidenceKey` vocabulary, with unknown keys reported, not silently dropped.

- **Board/detail UI (`AgentBoardRenderer` / `TaskCard` / `WorkOrderDetailModal`)** — cards add: changed-file count, missing-evidence badge, pending approval/input indicator, heartbeat age, stale flag. The detail pane adds an evidence section (changed files with attribution badges, verification results, references, caveats, risks) and gates the accept action on `ReviewGateResult.complete`, exposing the override path.

### Safety decisions

- Permission posture is unchanged from MVP: file writes limited to ask-gated; shell/network/commit gated to "ask"; push/PR excluded; secrets deny-by-default (never inject `.env*`, credential files, provider configs, or private keys into prompts/logs). Richer evidence does not grant new capability.
- Without worktrees, runs touch the working tree directly. Compare-and-swap note writes, changed-file attribution with explicit `unknown`/`conflicted`, and the evidence-gated review step are the trust controls for this increment. Worktree isolation is the named next increment and the seam is kept clean for it.
- Lane required-evidence and definitions of done are guidance and gate input only; they never grant permissions or override safety policy.

## Testing Decisions

A good test asserts external behavior through a module's public interface — inputs and observable outputs (returned values, written note content, emitted state, ledger entries) — never private methods or call order. Tests mirror `src/` under `tests/unit/` and `tests/integration/`; path-sensitive cases use the `itPosix` / `itWin32` helpers. Prior art: the MVP's `TaskStateMachine` pure-transition tests, `TaskNoteStore` round-trip/preservation tests, and the `ChatTabExecutionSurface` fake-runtime contract tests are the templates to follow.

TDD modules (all four selected for test-first development):

- **`RunEvidenceParser` + `EvidenceCompletenessEvaluator` (review gate)** (unit, pure) — parse round-trips for well-formed evidence; partial/malformed evidence yields `incomplete` with recorded reasons and never throws; absent block yields `none`; unknown fields ignored. Gate: every required key present and no failed verification → `complete`; any missing key or any `failed` verification → not complete with correct `missing` list and `hasFailedVerification`. Pure-function tests, no fixtures beyond input strings/objects.
- **`ChangedFileAttributor` fold** (unit, pure) — agent-only change → `attributed`; change with no agent signal → `unknown`; agent + external edit on the same file, and modified-after-write → `conflicted`; deletions and renames classify correctly; empty diffs produce empty results. Pure fold only; the git reader is exercised in integration.
- **`TaskLeaseManager`** (unit) — acquire succeeds on a free task and fails while a live lease is held; heartbeat refreshes staleness; `isStale` flips exactly at the timeout boundary; release frees the task; a reload-reconcile path marks an orphaned lease honestly. Time is injected, never read from the clock inside the module.
- **`TaskNoteStore` CAS + evidence region** (unit) — writing status/fields/evidence preserves unrelated frontmatter and user prose verbatim; evidence-region writes land only inside markers and are idempotent; a write whose pre-read hash no longer matches is rejected or merged without clobbering user edits; all three generated regions (ledger, handoff, evidence) coexist.
- **Execution-surface contract** (contract) — drive `ChatTabExecutionSurface` with a fake runtime emitting activity, tool-activity (with paths), approval-pending, ask-user-pending, plan-completed, resumed, cancellation, and provider error; assert the coordinator heartbeats the lease, sets `needs_approval`/`needs_input`, accumulates the agent-touched set, and on completion parses evidence, folds attribution, writes the evidence region, and transitions correctly.

Integration tests (representative subset):

- direct chat still works with no evidence/lease/board state loaded (non-regression);
- an MVP-style run with no evidence block completes into `review` flagged "no evidence reported" (non-regression);
- note → run → structured evidence parsed → evidence region written → review gate computed;
- review gate blocks `review → done` with missing evidence and routes to `needs_fix`; override records a ledger justification and allows `done`;
- changed-file attribution over a temp git repo yields `attributed`/`unknown`/`conflicted` correctly, including a human edit during the run producing `conflicted`;
- lease prevents a second concurrent run; plugin reload reconciles a live lease honestly; tab closed mid-run releases the lease;
- user edits the note during a run and the orchestrator write is merged via CAS without losing the edit;
- corrupted evidence is skipped and surfaced as a card error without crashing the board.

## Out of Scope

- **Git worktrees** — `GitWorktreeWorkspaceAllocator`, branch lifecycle, isolated worktree runs, and path containment are the explicit next increment, not this one. Runs stay in the current repo.
- **Claudian-run verification** — Claudian executing verification commands itself and capturing real exit codes. This increment is agent-reported, structured, and structure-validated only.
- Autonomous daemon, cron/scheduler, retry scheduling beyond manual retry; multi-agent concurrency, dependency DAGs, recursive spawning.
- Headless/background execution (`HeadlessExecutionSurface`).
- Workflow note parsing / `WorkflowNoteStore` and full workflow/template language; prompt rendering stays the built-in template plus evidence/DoD injection.
- Machine-readable rule packs (`claudian.agent-board.rules/v1`), Review Guard automation as an independent agent, and trace-learning playbooks.
- WIP-limit enforcement; automatic role-based routing.
- Auto-push / auto-PR / auto-merge; dependency installation without approval; agent-controlled permission or MCP/plugin changes; commit-identity/publish gating (no publish in scope).
- GitHub/Linear sync, multi-run comparison.
- Evidence schema migration tooling; cross-vault attribution.

## Acceptance Criteria Summary

This increment is acceptable when:

- Direct chat and the MVP run path both still work, with explicit non-regression coverage.
- An agent-reported structured evidence block is parsed into a typed evidence bundle and written to a generated evidence region; malformed/absent evidence degrades gracefully to `incomplete`/`none`.
- Changed files are reconciled against the working tree and shown as `attributed`/`unknown`/`conflicted`.
- Lanes carry machine-checkable required-evidence keys; `review → done` is blocked when evidence is missing or verification failed, with an audited override.
- A durable run lease enforces one run per work order, heartbeats while alive, flags stale runs, and reconciles honestly across reload and tab-close.
- Note writes during a run use compare-and-swap and never clobber user prose.
- Cards show changed-file count, missing-evidence, pending approval/input, and heartbeat/stale state; the detail pane shows the full evidence bundle and gates acceptance.
- The four selected TDD modules and representative integration tests pass.

## Further Notes

- This is the **richer-evidence** half of symphony Phase 2; the **safer-workspaces** half (git worktrees) is intentionally split into the following increment to keep this PRD focused and lower-risk. The workspace/execution seam is kept clean so the worktree allocator drops in behind it without reworking evidence, attribution, or leases.
- Verification is agent-reported now and Claudian-run later. The `VerificationResult` shape is designed to accept Claudian-executed results later without a schema break (the same `command` / `status` fields apply).
- This increment locks in long-term boundaries worth recording as ADRs once built: the run-evidence contract and `RunEvidence` shape, the `attributed | unknown | conflicted` attribution semantics, the durable lease/heartbeat model, and `TaskNoteStore` compare-and-swap. `docs/adr/` does not yet exist; create it when these land.
- Specorator transition context: structured evidence + review gate is the concrete realization of the "review with evidence" pillar and the configurable definition-of-done from [[2026-05-28-standalone-product-vision]]. It strengthens the migration demo without committing to worktrees or autonomy.
