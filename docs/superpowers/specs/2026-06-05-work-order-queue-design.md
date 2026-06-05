---
title: Work-order queue — automatic background runner for ready cards
date: 2026-06-05
status: draft
scope: agent-board-queue
related:
  - "[[2026-06-04-work-order-execution-design]]"
  - "[[Agent Kanban Board]]"
  - "[[As a User I want to queue Work-Orders]]"
---

# Work-order queue — automatic background runner for ready cards

## Summary

The Agent Board today only runs a work order when the user clicks Run on a single card. Multiple ready cards sit idle until the user comes back, clicks the next one, and waits. This spec adds a per-board background runner that picks the next eligible Ready / Needs-fix card and runs it as soon as a slot is free. Concurrency is configurable (default 1, matching the idea text "one by once"). A toolbar toggle pauses the runner per board and persists across reloads. Paused mid-run cards (`needs_input`, `needs_approval`) hold their slot — the queue waits for the user. Consecutive failures auto-halt the runner with a clear banner. Cards whose provider is disabled or whose model is not owned are skipped silently with a ledger note and a chip on the card.

Scope intentionally excludes new statuses, schema migrations, drag-to-reorder, dependency graphs between cards, and any per-provider routing. The prior P0+P1 work-order-execution spec listed "Tab queue / `waiting` status / per-provider concurrency caps" as a non-goal; this spec fills exactly that gap with the minimal surface.

## Goals

- Auto-pick the next eligible card when a slot is free.
- Toolbar `▶` / `⏸` toggle per board, persisted in board config.
- Configurable global concurrency cap (default 1, range 1–8) in plugin settings.
- Auto-halt after N consecutive failures (default 3, range 1–20); show banner.
- Skip cards with config issues, log to ledger, leave card in Ready with a skip chip.
- Ledger trail for every queue decision: started / skipped / halted / resumed.
- Coexist with the existing P0+P1 work-order-execution spec; no order dependency.

## Non-goals

- No `queued` / `waiting` / `blocked` task status.
- No per-provider concurrency cap (cap stays global across boards).
- No drag-to-reorder, no "run next" one-shot bump.
- No queue-level retry of failed cards.
- No queue-aware scheduling (time-of-day, rate-limit windows).
- No dependency graph between cards (`depends_on`).
- No cross-vault queue.

## Locked decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Trigger model | Auto-on + toolbar pause/resume (hybrid) |
| Concurrency | Configurable cap, default 1, max 8 |
| Status model | Reuse existing `ready` + `needs_fix`; no new status |
| Paused-run policy | Paused run holds its slot; queue waits |
| Failure policy | Auto-halt after N consecutive failures (default 3) |
| Ordering | Existing priority then created sort; no manual reorder |
| Pause persistence | Per-board, persisted in board config |
| Ineligible cards | Skip silently with ledger entry and on-card chip |

## State machine changes

None. Existing `TASK_STATUSES` and `LEGAL_TRANSITIONS` unchanged. Runner uses the same `coordinator.run()` path as a manual click. Pause / approval transitions added by the P0+P1 spec (`running ↔ needs_input`, `running ↔ needs_approval`) are honored by the slot-hold policy below.

## Components and files

### New

| File | Purpose | LoC budget |
|------|---------|-----------|
| `src/features/tasks/execution/QueueRunner.ts` | Per-board background loop. Owns pause state, halted state, consecutive-failure counter, event subscriptions. | ~220 |
| `src/features/tasks/execution/QueueSlotTracker.ts` | Cap-aware in-flight set shared across boards. `acquire` / `release` / `hasFreeSlot` / `setCap`. | ~60 |
| `src/features/tasks/execution/selectNextEligibleTask.ts` | Wraps existing `selectNextReadyTask`. Combines status check with provider/model eligibility predicate. Returns `{ kind: 'ok', task }` or `{ kind: 'skipped', task, reason }` or `null`. | ~80 |

### Changed

| File | Change |
|------|--------|
| `src/features/tasks/execution/TaskRunCoordinator.ts` | No behavior change. Existing `activeRuns` lock continues to prevent double-start on the same id. |
| `src/features/tasks/events.ts` | Add `task:queue-tick`, `task:queue-paused`, `task:queue-resumed`, `task:queue-halted`, `task:queue-skipped`. |
| `src/features/tasks/ui/AgentBoardView.ts` | Construct `QueueRunner` on mount; wire toolbar toggle; mount halt banner; dispose on close. |
| `src/features/tasks/ui/AgentBoardRenderer.ts` | Toolbar render with toggle + slot count + failure count; halt banner; per-card skip chip. |
| `src/features/tasks/model/taskTypes.ts` | `BoardConfig.queue: { paused: boolean }` (optional, defaults false). |
| `src/features/tasks/storage/BoardConfigStore.ts` | Round-trip `queue.paused`. |
| `src/app/defaultSettings.ts` | `agentBoardQueueCap: 1`; `agentBoardQueueHaltAfter: 3`. |
| `src/features/settings/GeneralTab.ts` | Two number inputs (cap, halt threshold) in new "Agent Board Queue" group. |
| `src/style/tasks/_agent-board.css` | Toolbar styles, halt banner, skip chip. |

### Plugin-level wiring

A single `QueueSlotTracker` is owned by the plugin (constructed near `TaskRunCoordinator`). All `QueueRunner` instances receive it via dependency injection. This is what "global cap" means in practice: per-Obsidian-session, shared across however many boards the user opens.

## Settings, persistence, and state

### Per-board (persisted)

```typescript
interface BoardConfig {
  // existing fields...
  queue?: {
    paused: boolean;        // default false
  };
}
```

Missing `queue` block parses as `{ paused: false }`.

### Plugin-level (persisted in `.claudian/claudian-settings.json`)

```typescript
interface AgentBoardQueueSettings {
  cap: number;               // default 1; min 1; max 8
  haltAfterFailures: number; // default 3; min 1; max 20
}
```

Surfaced in the General settings tab under an "Agent Board Queue" group with inline help text.

### In-memory runner state (not persisted)

```typescript
interface QueueRunnerState {
  paused: boolean;                            // mirrors BoardConfig.queue.paused
  halted: boolean;                            // true after N consecutive failures
  haltReason: string | null;                  // shown in banner
  consecutiveFailures: number;                // resets on any non-failed terminal
  lastSkipReasonByTask: Map<string, string>;  // for chip rendering
}
```

Plugin reload clears `halted` and the counter. This is intentional minimalism: the existing P0+P1 orphan-scan marks abandoned `running` cards as `failed` before the runner mounts; counting those against the threshold would surprise the user with an immediate halt.

### Pause vs halt UI states

| State | Toolbar icon | Banner | Behavior |
|---|---|---|---|
| Running | `⏸ Queue` | none | Auto-picks |
| Paused (user) | `▶ Queue` | "Queue paused" pill | No tick |
| Halted (safety) | `▶ Queue` with warning dot | "Queue halted: N consecutive failures. Last: {reason}" with Resume + Open failed buttons | No tick; `▶` clears halt |
| Paused + halted | `▶ Queue` with warning dot | both | No tick; `▶` clears both in one click |

## Slot accounting

```typescript
class QueueSlotTracker {
  constructor(private cap: number) {}
  occupied(): number;
  capacity(): number;
  hasFreeSlot(): boolean;
  acquire(taskId: string): boolean;   // false if cap reached or id already held
  release(taskId: string): void;
  isHeld(taskId: string): boolean;
  setCap(next: number): void;          // live; never cancels in-flight when shrinking
}
```

### Slot lifecycle vs task status

| Task transition | Slot action |
|---|---|
| Runner picks card → `running` | `acquire(id)` before `coordinator.run()` |
| `running` → `needs_input` / `needs_approval` | **Hold**. Slot stays occupied. |
| `needs_input` / `needs_approval` → `running` (user resume) | No-op. Already held. |
| `running` → `review` / `failed` / `canceled` | `release(id)` after coordinator settles. |
| `needs_input` / `needs_approval` → `failed` / `canceled` | `release(id)`. |

### Manual runs

The slot is held by **runner-launched** runs only. When the user clicks Run on a card directly, the slot tracker is bypassed; only `TaskRunCoordinator.activeRuns` prevents double-start of the same id. Rationale: queue cap is "how many cards may the runner auto-start", not "how many runs may exist". Manual click is explicit override.

Trade-off: cap=1 + manual click during auto-run = 2 simultaneous runs. Acceptable; user opted in. Toolbar shows `2/1 active` in that state.

### Cap-change live

User raises cap from 1 to 3: `setCap(3)` mutates the tracker; the next tick opens slots up to the new cap. Existing runs continue unaffected. Lowering the cap below the current occupied count never cancels in-flight runs — new picks just stop until `occupied() <= cap`.

## Eligibility and skip

`selectNextEligibleTask` extends the existing `selectNextReadyTask`. Steps per call:

1. Filter to `status ∈ {ready, needs_fix}` and not currently in `coordinator.activeRuns`.
2. Sort by `priority` ascending then `created` ascending (existing behavior).
3. Take the first candidate. Evaluate eligibility predicate:
   - `provider` field present and non-empty;
   - `model` field present and non-empty;
   - `isProviderEnabled(provider)` true;
   - `ownsModel(provider, model)` true.
4. If eligible → return `{ kind: 'ok', task }`.
5. If not eligible → return `{ kind: 'skipped', task, reason }` with a stable reason string.
6. Caller (`QueueRunner.doTick`) records the skip and re-asks `selectNextEligibleTask` excluding that id. Drains the cascade in one tick.

Reason strings (stable, used in ledger and chip):

- `provider '{id}' is disabled`
- `model '{model}' is not available for provider '{id}'`
- `work order is missing provider`
- `work order is missing model`

### Skip ledger entries

```
[ready] queue: skipped (provider 'codex' is disabled)
[ready] queue: skipped (model 'claude-sonnet-4-5' is not available for provider 'claude')
[ready] queue: skipped (work order is missing provider)
```

Per-task, per-reason debounce window of 60s. Same `(taskId, reason)` pair within 60s only writes one ledger entry. Prevents tick-loop ledger spam when a provider stays disabled.

## Runner loop

`QueueRunner` is event-driven, not polled. Subscribes to:

- `task:status-changed` — any card status flip
- `task:run-finished` — fallback to slot-release tick
- `task:board-config-changed` — provider/model eligibility may have shifted
- `task:queue-paused`, `task:queue-resumed` — user intent
- settings change (cap, halt threshold) — re-tick after cap update

Tick is non-re-entrant with a pending flag:

```typescript
class QueueRunner {
  private pending = false;
  private running = false;

  tick() {
    if (this.running) { this.pending = true; return; }
    this.running = true;
    try {
      this.doTick();
    } finally {
      this.running = false;
      if (this.pending) { this.pending = false; queueMicrotask(() => this.tick()); }
    }
  }

  private doTick() {
    if (this.state.paused || this.state.halted) return;
    const excluded = new Set<string>();
    while (this.slot.hasFreeSlot()) {
      const pick = selectNextEligibleTask(this.tasks(), this.eligibility, excluded);
      if (!pick) return;
      if (pick.kind === 'skipped') {
        this.recordSkip(pick.task, pick.reason);
        excluded.add(pick.task.frontmatter.id);
        continue;
      }
      this.launch(pick.task);
      // launch acquires a slot; loop re-asks hasFreeSlot()
    }
  }

  private launch(task: TaskSpec) {
    if (!this.slot.acquire(task.frontmatter.id)) return;
    // re-check eligibility window between pick and acquire
    if (!this.isStillEligible(task)) {
      this.slot.release(task.frontmatter.id);
      return;
    }
    this.events.emit('task:queue-tick', { taskId: task.frontmatter.id });
    this.coordinator.run(task)
      .then((res) => this.onSettle(task, res))
      .catch((err) => this.onSettle(task, { ok: false, error: String(err) }))
      .finally(() => {
        this.slot.release(task.frontmatter.id);
        this.tick();
      });
  }

  private onSettle(task: TaskSpec, res: TaskRunResult) {
    const failed = !res.ok && this.lastTerminalStatus(task) === 'failed';
    if (failed) {
      this.state.consecutiveFailures++;
      if (this.state.consecutiveFailures >= this.haltAfter) {
        this.state.halted = true;
        this.state.haltReason = `${this.state.consecutiveFailures} consecutive failures · last: ${res.error ?? 'unknown'}`;
        this.events.emit('task:queue-halted', { reason: this.state.haltReason });
      }
    } else {
      this.state.consecutiveFailures = 0;
    }
  }
}
```

### Counter scope

Per-runner (per-board). Manual-run failures do not increment — only runner-launched runs do. Keeps the halt signal pure: "the auto-run pattern is unhealthy", not "the user is debugging this card".

A `review` outcome counts as success even if the user later flips it to `needs_fix`; the counter measures the runner's chosen path to terminal, not downstream review verdict.

### Resume from halt

User clicks `▶` while halted: emit `task:queue-resumed` → runner clears `halted`, `haltReason`, and `consecutiveFailures` → tick. If `paused` was also set, the same click clears both (single recovery action).

## UI

### Board toolbar

```
┌─────────────────────────────────────────────────────────────┐
│ [⏸ Queue]  2/3 active  · 0 failures               [▼ Filter]│
└─────────────────────────────────────────────────────────────┘
```

| Element | Source | Updates |
|---|---|---|
| Toggle (`⏸ Queue` / `▶ Queue`) | `state.paused` | on `task:queue-paused` / `task:queue-resumed` |
| Slot count `N/cap active` | `slot.occupied()` + `slot.capacity()` | on `task:queue-tick`, `task:run-finished` |
| Failure counter `· N failures` (only when > 0) | `state.consecutiveFailures` | on `task:run-finished` |

Click toggle: writes `BoardConfigStore.update({ queue: { paused: next } })`; on write failure, revert UI and show a toast. If the toggle is clicked while halted, the same click also clears the halt.

### Halt banner

Below the toolbar, above the columns, only when `state.halted`:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠ Queue halted: 3 consecutive failures.                     │
│   Last: Run failed — Provider transport error               │
│   [Resume queue]  [Open failed cards]                       │
└─────────────────────────────────────────────────────────────┘
```

- **Resume queue** → emit `task:queue-resumed`; same effect as toolbar `▶`.
- **Open failed cards** → use existing filter wiring to set the board filter to `status=failed`.

### Per-card skip chip

Small inline indicator on cards skipped this session, only when card status is still `ready` / `needs_fix` and the skip reason has not been cleared:

```
│ Title                                  [ready] │
│ codex / gpt-5      ·  1 - high                 │
│ ⊘ Queue skipped: provider 'codex' is disabled  │
└────────────────────────────────────────────────┘
```

Chip cleared by any of:

- card status transitions away from `ready` / `needs_fix`;
- next eligibility evaluation returns `ok` for that card;
- user clicks the chip (acknowledge).

### DOM patching

Reuse the per-card DOM diffing the P0+P1 spec adds. Queue events route as:

- `task:board-config-changed`, cap change, capacity change → `renderInitial`
- `task:queue-paused`, `task:queue-resumed`, `task:queue-halted` → toolbar + banner patch only
- `task:queue-tick`, `task:queue-skipped` → toolbar count + per-card chip patch only
- `task:run-finished` → toolbar count patch + per-card patch

No new modals. No card detail-modal additions beyond the existing ledger view (queue entries already appear there inline).

### CSS additions

- `claudian-agent-board-toolbar`, `--queue-toggle`, `--queue-active-count`, `--queue-failure-count`
- `claudian-agent-board-banner-halt`
- `claudian-agent-board-card-skip-chip`

## Error handling and edge cases

| Case | Detection | Behavior |
|---|---|---|
| Provider disabled at pick time | `selectNextEligibleTask` predicate | Skip; ledger entry; chip on card |
| Model not owned | same | Skip; ledger; chip |
| Provider / model frontmatter missing | same | Skip; ledger; chip |
| `coordinator.run` rejects with thrown error | `.catch` in `launch` | Treat as failed result; release slot; counter++ |
| Cap raised mid-run | `setCap(n)` | Next tick opens slots up to new cap; in-flight unaffected |
| Cap lowered below in-flight count | `setCap(n)` with `occupied() > n` | In-flight continue; no new picks until `occupied() <= n` |
| User pauses mid-tick | event fires during `doTick` | Loop exits at next iteration; in-flight run continues to natural end |
| User pauses while halted | toolbar click | Sets `paused=true`; halt stays; later `▶` clears both |
| All Ready cards skipped | `selectNextEligibleTask` exhausted | Tick exits cleanly; next status-change re-ticks |
| `task:status-changed` for a manual run | event | Tick runs; manual-run id is `status=running` so excluded; no double-launch |
| Card moves Ready → Inbox between pick and `acquire` | re-check after `acquire` | Release slot; tick continues with next |
| Crash mid-run | existing P0+P1 orphan-scan | Marks `running` cards `failed` before runner mounts; counter starts at 0 |
| `BoardConfigStore` write failure (persist pause) | catch | Revert toggle UI; toast "Failed to save queue state"; log via leveled logger |
| Settings write failure (cap change) | catch | Revert input; toast; log |
| Two boards mounted simultaneously | each owns a `QueueRunner`; shared `QueueSlotTracker` | First `acquire` wins (single-threaded JS); idle board picks next free slot |
| `task:queue-skipped` flood | per-`(taskId, reason)` 60s debounce on ledger writes | One ledger entry per debounce window |
| Halt triggers while a run is mid-stream | counter only increments on terminal | Mid-stream run completes normally; if it fails, that's the next increment |

## Testing

### Unit (new)

| Spec | Coverage |
|---|---|
| `tests/unit/features/tasks/execution/QueueSlotTracker.test.ts` | acquire/release; cap enforcement; double-acquire same id returns false; `setCap` live; shrink below occupied does not cancel; capacity introspection |
| `tests/unit/features/tasks/execution/selectNextEligibleTask.test.ts` | priority + created ordering preserved; provider-disabled → skipped with reason; model-unowned → skipped; missing provider / model → skipped; first eligible returned when mixed; excluded set respected |
| `tests/unit/features/tasks/execution/QueueRunner.test.ts` | tick gated by paused/halted; skip-cascade drains in one tick; consecutive failures increment; counter resets on non-failed terminal; halt fires at threshold and emits event; cap=2 launches 2 in parallel; manual-run id excluded from auto-pick; re-check after `acquire` releases slot if status changed; pending-flag re-entrancy; dispose unsubscribes events; resume clears halt + counter + paused in one click |

### Unit (extended)

| Spec | Add |
|---|---|
| `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts` | assert `activeRuns` lock still blocks runner double-start when manual click races with auto-pick |
| `tests/unit/features/tasks/storage/BoardConfigStore.test.ts` | `queue.paused` round-trip; default false; missing `queue` block parses cleanly |
| `tests/unit/app/defaultSettings.test.ts` | `agentBoardQueueCap=1`, `agentBoardQueueHaltAfter=3` defaults; bounds enforced (1–8, 1–20) |
| `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts` | toolbar toggle renders correct icon per state; halt banner shows on halted; skip chip renders + clears on status change + ack click |

### Integration (new) under `tests/integration/features/tasks/`

| Spec | Flow |
|---|---|
| `queueRunner.basicDrain.test.ts` | 3 ready cards, cap=1, runner drains all to review in priority+created order |
| `queueRunner.holdSlotOnPause.test.ts` | Card pauses on `needs_input` → slot held → second ready card NOT picked → reply resumes → review → second card runs |
| `queueRunner.haltAfterFailures.test.ts` | 3 cards rigged to fail → counter increments → halt at 3 → ▶ click clears halt and counter → 4th card runs |
| `queueRunner.skipIneligible.test.ts` | Card with disabled provider → skip with ledger entry + chip → runner moves to next eligible |
| `queueRunner.capChangeLive.test.ts` | cap=1 with 1 in flight → raise to 2 → next tick launches second card |
| `queueRunner.pausePersisted.test.ts` | Pause via toolbar → reload board → still paused → resume runs queue |
| `queueRunner.manualRunDoesNotCountAgainstCap.test.ts` | cap=1, runner running A, user clicks Run on B → both active; manual B failure does NOT increment halt counter |
| `queueRunner.twoBoardsShareCap.test.ts` | Two boards mounted, cap=1 → only one card runs across both boards |
| `queueRunner.crashRecoveryCounterReset.test.ts` | Orphaned `running` card → P0+P1 scan marks failed → runner mounts → counter starts at 0, halt not tripped |
| `queueRunner.skipLedgerDebounced.test.ts` | Persistent ineligibility → only one ledger entry per 60s window per reason |

### Perf (new) under `tests/perf/`

| Spec | Guard |
|---|---|
| `queueRunner.perf.ts` | `tick()` cost stays O(eligible cards), not O(total tasks); event subscription teardown constant time; scales with board size |

### Manual smoke (DoD item)

1. Open board with 3 ready cards (mixed providers). Runner drains them sequentially. Ledger shows queue entries.
2. Pause mid-run via toolbar. Active run finishes. Next card stays Ready.
3. Resume. Next card auto-runs.
4. Force a card to pause (`<claudian_needs_input>` block — depends on P0+P1 shipped). Confirm second card does not start.
5. Disable a provider in settings. Card with that provider shows skip chip, stays Ready.
6. Raise cap to 2. Two cards run in parallel.
7. Trigger 3 consecutive failures (point a card at a bad model name). Halt banner appears. Click Resume queue. Banner clears.
8. Restart Obsidian after pausing. Confirm board re-opens with queue paused.

Recorded by attaching the board's ledger to the implementation PR.

## Migration and compatibility

- `BoardConfig.queue.paused` is a new optional field. Existing board configs parse with `paused: false` default. No vault data migration.
- New settings keys (`agentBoardQueueCap`, `agentBoardQueueHaltAfter`) default at first read. Existing `claudian-settings.json` without them works unchanged.
- No new `TaskStatus`. No frontmatter schema change. Hand-edited work orders unaffected.
- `schema_version` stays at `1`.
- Coexists with the P0+P1 work-order-execution spec. Order-independent: this runner can ship before, after, or alongside. If shipped before P0+P1, the runner still works against the current binary `ready → running → review` flips; the slot-hold-on-pause behavior is dormant until `needs_input` / `needs_approval` are activated by P0+P1.

## Definition of Done

- All new unit + integration tests pass.
- Perf gate green.
- Manual smoke checklist completed; ledger attached to PR.
- `npm run typecheck && npm run lint && npm run test && npm run build` clean.
- Two-board scenario verified once (shared cap behavior).
- Pause-persisted state survives Obsidian restart.
- Halt banner clears on resume; counter resets correctly.
- Skip chip clears when card eligibility recovers (re-enable provider mid-session).
- No `console.*` in production code.

## Implementation order (suggested for planning)

1. `BoardConfig.queue.paused` + `BoardConfigStore` round-trip + defaults. Tests first.
2. Plugin settings keys + General-tab UI inputs + bounds. Tests.
3. `QueueSlotTracker` + tests. Pure, isolated.
4. `selectNextEligibleTask` + tests. Wraps existing `selectNextReadyTask`.
5. `events.ts` additions for queue events.
6. `QueueRunner` + tests using synthetic coordinator + slot tracker.
7. Plugin-level singleton wiring: shared `QueueSlotTracker`; runner factory per board.
8. `AgentBoardView` mounts runner; toolbar toggle; halt banner; skip chip; tests.
9. CSS additions.
10. Integration tests across all ten scenarios.
11. Manual smoke + DoD verification.

Each numbered step lands as its own change with passing tests.
