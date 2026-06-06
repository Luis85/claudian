---
title: Work-order Queue Implementation Plan
date: 2026-06-05
status: in-progress
parent: "[[2026-06-05-work-order-queue-design]]"
---

# Work-order Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-board background runner that auto-picks the next eligible Ready / Needs-fix work order, with configurable concurrency (default 1), persistent toolbar pause/resume per board, slot-hold-on-pause behavior, and an auto-halt after N consecutive failures. Skip cards whose provider is disabled or whose model is not owned with a ledger entry and on-card chip.

## Bug-fix follow-up (2026-06-06)

The Agent Board queue follow-up in [[Agent Board/tasks/task-20260606100000-bug-fix]] tightened the intended workflow:

- New work orders default to `inbox` unless a caller explicitly requests another state, so planning happens before queue eligibility.
- The queue control starts paused on every Obsidian/plugin load; a saved running state is ignored until the user clicks **Run queue** in that session.
- Agent Board chrome is a single toolbar row: actions on the left, queue/chat-tab information on the right, with the existing bottom border retained.
- Queue failure state emits a queue-state repaint event after run settlement, so stale failure text clears when the failure streak resets.
- Non-running recovery states have user-visible recovery paths: **Retry** (failed/canceled → ready), **Back to inbox** for non-live recoverable states (ready/failed/canceled/review/needs_fix/needs_handoff), and the lane-specific review/handoff actions. Live paused states (`needs_input`/`needs_approval`) are intentionally left to their on-card reply surface (Send/Approve/Reject/Stop): a bare status transition there would strand the still-running `RunSession` and leak the queue slot it holds.

**Architecture:** A plugin-level singleton `QueueSlotTracker` enforces the global concurrency cap across boards. Each `AgentBoardView` constructs a `QueueRunner` on mount that subscribes to task events and picks the next eligible card via `selectNextEligibleTask` (a wrapper over the existing `selectNextReadyTask`). The runner calls the existing `TaskRunCoordinator.run()` — no coordinator behavior change. UI surfaces (toolbar toggle, toolbar halt/status text, skip chip) live in `AgentBoardRenderer` and route updates via new `task:queue-*` events.

**Tech Stack:** TypeScript, Jest, existing Claudian event bus (`src/core/events/EventBus.ts`), existing settings registry (`src/features/settings/registry/`), existing `BoardConfigStore` (`src/features/tasks/config/BoardConfigStore.ts`), existing `TaskRunCoordinator` (`src/features/tasks/execution/TaskRunCoordinator.ts`).

---

## Scope Check

Implements the approved design in [[2026-06-05-work-order-queue-design]]. Coexists order-independently with [[2026-06-04-work-order-execution-design]] (P0+P1). Out of scope per the spec: new task statuses, per-provider cap, drag-to-reorder, queue-level retry, dependency graphs, time-of-day scheduling, cross-vault queue.

If task count makes a single PR unwieldy, Tasks 1–6 (groundwork: types, settings, slot tracker, eligibility, events, runner) can ship as one PR and Tasks 7–14 (plugin wiring + UI + integration tests + smoke) as a follow-up. The split is clean because Tasks 1–6 produce no user-visible change yet.

## File Structure

**Create:**
- `src/features/tasks/execution/QueueSlotTracker.ts` — cap-aware in-flight set; shared across boards.
- `src/features/tasks/execution/selectNextEligibleTask.ts` — wraps `selectNextReadyTask` with provider/model eligibility predicate.
- `src/features/tasks/execution/QueueRunner.ts` — per-board background loop.

**Modify:**
- `src/features/tasks/config/boardConfigTypes.ts` — add `queue?: { paused: boolean }` to `BoardConfig`.
- `src/features/tasks/config/BoardConfigStore.ts` — round-trip `queue.paused`.
- `src/core/types/settings.ts` — add `agentBoardQueueCap` and `agentBoardQueueHaltAfter` fields.
- `src/app/settings/defaultSettings.ts` — default 1 and 3.
- `src/features/settings/registry/fields/agentBoard.ts` — register a "Queue" section with two number fields.
- `src/features/tasks/events.ts` — add five queue events to `TaskEventMap`.
- `src/features/tasks/execution/TaskRunCoordinator.ts` — expose an `isActive(id)` getter for the eligibility predicate.
- `src/features/tasks/storage/TaskNoteStore.ts` — used by runner to write skip-ledger entries (no shape change; reuse `appendLedger`).
- `src/main.ts` — construct `QueueSlotTracker` singleton and inject into `AgentBoardView` factory.
- `src/features/tasks/ui/AgentBoardView.ts` — mount `QueueRunner` on `onOpen`, dispose on `onClose`, wire toolbar callbacks.
- `src/features/tasks/ui/AgentBoardRenderer.ts` — toolbar (toggle + counts), halt banner, per-card skip chip.
- `src/style/tasks/_agent-board.css` — toolbar, banner, chip styles.

**Mirrored test files** under `tests/unit/features/tasks/execution/`, `tests/unit/features/tasks/config/`, `tests/unit/features/tasks/ui/`, `tests/unit/app/settings/`, `tests/integration/features/tasks/`, `tests/perf/`.

---

### Task 1: Add `queue.paused` to `BoardConfig` type

**Files:**
- Modify: `src/features/tasks/config/boardConfigTypes.ts`

- [ ] **Step 1: Add optional `queue` block to `BoardConfig`**

Open `src/features/tasks/config/boardConfigTypes.ts`. Find the `BoardConfig` interface (around line 13). Add the optional `queue` field:

```typescript
export interface BoardConfig {
  schemaVersion: 1;
  lanes: BoardLaneConfig[];
  queue?: BoardQueueConfig;
}

export interface BoardQueueConfig {
  paused: boolean;
}
```

- [ ] **Step 2: Run typecheck to confirm no breakage**

Run: `npm run typecheck`
Expected: PASS (no callers depend on `queue` yet; new field is optional).

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/config/boardConfigTypes.ts
git commit -m "feat(tasks): add optional queue.paused to BoardConfig"
```

---

### Task 2: Round-trip `queue.paused` in `BoardConfigStore`

**Files:**
- Modify: `src/features/tasks/config/BoardConfigStore.ts`
- Test: `tests/unit/features/tasks/config/BoardConfigStore.test.ts`

- [ ] **Step 1: Write the failing test for default**

Open (create if missing) `tests/unit/features/tasks/config/BoardConfigStore.test.ts`. Add:

```typescript
import { loadBoardConfig } from '../../../../../src/features/tasks/config/BoardConfigStore';

describe('loadBoardConfig — queue.paused', () => {
  it('defaults queue.paused to false when settings have no queue block', () => {
    const { config } = loadBoardConfig({
      agentBoardConfig: {
        lanes: [{ id: 'inbox', title: 'Inbox', statuses: ['inbox'] }],
      },
    });
    expect(config.queue).toEqual({ paused: false });
  });

  it('round-trips queue.paused=true from settings', () => {
    const { config } = loadBoardConfig({
      agentBoardConfig: {
        lanes: [{ id: 'inbox', title: 'Inbox', statuses: ['inbox'] }],
        queue: { paused: true },
      },
    });
    expect(config.queue).toEqual({ paused: true });
  });

  it('coerces malformed queue block to default', () => {
    const { config } = loadBoardConfig({
      agentBoardConfig: {
        lanes: [{ id: 'inbox', title: 'Inbox', statuses: ['inbox'] }],
        queue: 'nope',
      },
    });
    expect(config.queue).toEqual({ paused: false });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- --selectProjects unit -t "loadBoardConfig — queue.paused"`
Expected: FAIL (`config.queue` undefined).

- [ ] **Step 3: Implement queue round-trip in `loadBoardConfig`**

In `src/features/tasks/config/BoardConfigStore.ts`, modify the `loadBoardConfig` function. At the end, before `return`, build the queue block:

```typescript
const queue = normalizeQueue(candidate);
return { config: { schemaVersion: 1, lanes, queue }, errors };
```

Also update the early-return `DEFAULT_BOARD_CONFIG` paths — wrap them so `queue` is always present. Add the helper at module bottom:

```typescript
function normalizeQueue(raw: { queue?: unknown }): { paused: boolean } {
  const q = raw.queue;
  if (!q || typeof q !== 'object') return { paused: false };
  const paused = Boolean((q as { paused?: unknown }).paused);
  return { paused };
}
```

Update `DEFAULT_BOARD_CONFIG` in `boardConfigTypes.ts` to include `queue: { paused: false }`:

```typescript
export const DEFAULT_BOARD_CONFIG: BoardConfig = Object.freeze({
  schemaVersion: 1,
  lanes: Object.freeze(
    TASK_STATUSES.map((status) => /* unchanged */),
  ) as BoardLaneConfig[],
  queue: Object.freeze({ paused: false }),
}) as BoardConfig;
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- --selectProjects unit -t "loadBoardConfig — queue.paused"`
Expected: PASS (all three cases).

- [ ] **Step 5: Write the failing test for save side**

We do not have a "save" helper today — `BoardConfigStore.ts` only loads. The save path goes through `plugin.saveSettings` mutating `settings.agentBoardConfig` directly. Add a save helper:

```typescript
// in BoardConfigStore.test.ts
import { writeBoardQueuePaused } from '../../../../../src/features/tasks/config/BoardConfigStore';

describe('writeBoardQueuePaused', () => {
  it('sets queue.paused on the settings object in place', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: { lanes: [], queue: { paused: false } },
    };
    writeBoardQueuePaused(settings, true);
    expect(settings.agentBoardConfig).toEqual({
      lanes: [],
      queue: { paused: true },
    });
  });

  it('creates the queue block if missing', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: { lanes: [] },
    };
    writeBoardQueuePaused(settings, true);
    expect(settings.agentBoardConfig).toEqual({
      lanes: [],
      queue: { paused: true },
    });
  });

  it('creates agentBoardConfig if missing', () => {
    const settings: Record<string, unknown> = {};
    writeBoardQueuePaused(settings, true);
    expect(settings.agentBoardConfig).toEqual({
      lanes: [],
      queue: { paused: true },
    });
  });
});
```

- [ ] **Step 6: Run the test to confirm it fails**

Run: `npm run test -- --selectProjects unit -t "writeBoardQueuePaused"`
Expected: FAIL (export not found).

- [ ] **Step 7: Implement the save helper**

Append to `src/features/tasks/config/BoardConfigStore.ts`:

```typescript
export function writeBoardQueuePaused(
  settings: Record<string, unknown>,
  paused: boolean,
): void {
  const existing = settings.agentBoardConfig;
  const base = existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : { lanes: [] };
  if (!('lanes' in base) || !Array.isArray((base as { lanes?: unknown }).lanes)) {
    (base as { lanes: unknown }).lanes = [];
  }
  (base as { queue: { paused: boolean } }).queue = { paused };
  settings.agentBoardConfig = base;
}
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `npm run test -- --selectProjects unit -t "writeBoardQueuePaused"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/tasks/config/BoardConfigStore.ts src/features/tasks/config/boardConfigTypes.ts tests/unit/features/tasks/config/BoardConfigStore.test.ts
git commit -m "feat(tasks): persist queue.paused in BoardConfig"
```

---

### Task 3: Add queue settings keys + defaults

**Files:**
- Modify: `src/core/types/settings.ts`
- Modify: `src/app/settings/defaultSettings.ts`
- Test: `tests/unit/app/settings/defaultSettings.test.ts`

- [ ] **Step 1: Write the failing test**

Open (create if missing) `tests/unit/app/settings/defaultSettings.test.ts`. Add:

```typescript
import { DEFAULT_CLAUDIAN_SETTINGS } from '../../../../src/app/settings/defaultSettings';

describe('DEFAULT_CLAUDIAN_SETTINGS — queue', () => {
  it('defaults agentBoardQueueCap to 1', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.agentBoardQueueCap).toBe(1);
  });

  it('defaults agentBoardQueueHaltAfter to 3', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.agentBoardQueueHaltAfter).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- --selectProjects unit -t "DEFAULT_CLAUDIAN_SETTINGS — queue"`
Expected: FAIL (properties undefined).

- [ ] **Step 3: Add fields to `ClaudianSettings` type**

Open `src/core/types/settings.ts`. Find the `ClaudianSettings` interface. Add near the other `agentBoard*` fields:

```typescript
agentBoardQueueCap: number;
agentBoardQueueHaltAfter: number;
```

- [ ] **Step 4: Add defaults**

In `src/app/settings/defaultSettings.ts`, near the existing `agentBoard*` defaults (around line 69–74), add:

```typescript
agentBoardQueueCap: 1,
agentBoardQueueHaltAfter: 3,
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm run test -- --selectProjects unit -t "DEFAULT_CLAUDIAN_SETTINGS — queue"`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts tests/unit/app/settings/defaultSettings.test.ts
git commit -m "feat(settings): add agentBoardQueueCap and agentBoardQueueHaltAfter defaults"
```

---

### Task 4: Register queue settings fields in Agent Board tab

**Files:**
- Modify: `src/features/settings/registry/fields/agentBoard.ts`

- [ ] **Step 1: Add "Queue" section above "Templates"**

Open `src/features/settings/registry/fields/agentBoard.ts`. After the `commitOnAccept` section registration (around line 76), insert a new section registration:

```typescript
r.registerSection({
  id: 'queue',
  tabId: 'agentBoard',
  label: 'Queue',
  order: 35,
  description: 'Background runner that auto-picks Ready and Needs-fix cards.',
});
```

- [ ] **Step 2: Register the cap field**

After the `promptCommitOnAccept` field registration (around line 181), add:

```typescript
r.registerField({
  id: 'agentBoardQueueCap',
  tabId: 'agentBoard',
  sectionId: 'queue',
  label: 'Concurrent runs',
  description: 'Maximum number of cards the queue runner may auto-start at once, shared across all boards.',
  type: { kind: 'number', min: 1, max: 8, step: 1 },
  default: 1,
  keywords: ['queue', 'concurrent', 'cap', 'parallel'],
});
```

- [ ] **Step 3: Register the halt-threshold field**

Immediately after:

```typescript
r.registerField({
  id: 'agentBoardQueueHaltAfter',
  tabId: 'agentBoard',
  sectionId: 'queue',
  label: 'Auto-halt after consecutive failures',
  description: 'Pause the queue after this many auto-run failures in a row. Manual runs do not count.',
  type: { kind: 'number', min: 1, max: 20, step: 1 },
  default: 3,
  keywords: ['queue', 'halt', 'failure', 'safety'],
});
```

- [ ] **Step 4: Run typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual sanity check (optional)**

Open Obsidian (the dev build copies the plugin into the vault per the dev-build-setup memory). Open Settings → Claudian → Agent Board. Confirm a new "Queue" section appears with two number inputs. Defaults visible: 1 and 3.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/registry/fields/agentBoard.ts
git commit -m "feat(settings): expose queue cap and halt threshold in Agent Board tab"
```

---

### Task 5: Add queue events to `TaskEventMap`

**Files:**
- Modify: `src/features/tasks/events.ts`

- [ ] **Step 1: Add the five queue events**

Open `src/features/tasks/events.ts`. Append to the `TaskEventMap` interface:

```typescript
export interface TaskEventMap {
  // existing entries...

  /** Emitted when the queue runner launches a card. */
  'task:queue-tick': { taskId: string };
  /** Emitted when the user pauses the queue runner on a board. */
  'task:queue-paused': void;
  /** Emitted when the user resumes the queue runner on a board. */
  'task:queue-resumed': void;
  /** Emitted when the queue runner auto-halts after consecutive failures. */
  'task:queue-halted': { reason: string };
  /** Emitted when the runner skips a card for an eligibility reason. */
  'task:queue-skipped': { taskId: string; reason: string };
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/events.ts
git commit -m "feat(tasks): add queue-* events to TaskEventMap"
```

---

### Task 6: Expose `isActive(id)` on `TaskRunCoordinator`

**Files:**
- Modify: `src/features/tasks/execution/TaskRunCoordinator.ts`
- Test: `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts` (extend if exists, create otherwise):

```typescript
import { TaskRunCoordinator } from '../../../../../src/features/tasks/execution/TaskRunCoordinator';

describe('TaskRunCoordinator.isActive', () => {
  it('reports false for ids not in flight', () => {
    const c = new TaskRunCoordinator({
      executionSurface: {} as never,
      now: () => '2026-06-05T00:00:00Z',
      isProviderEnabled: () => true,
      ownsModel: () => true,
      writeTaskStatus: async () => {},
      appendLedger: async () => {},
      writeHandoff: async () => {},
    });
    expect(c.isActive('task-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- --selectProjects unit -t "TaskRunCoordinator.isActive"`
Expected: FAIL (`isActive` not defined).

- [ ] **Step 3: Implement the getter**

In `src/features/tasks/execution/TaskRunCoordinator.ts`, after the `run` method, add:

```typescript
isActive(taskId: string): boolean {
  return this.activeRuns.has(taskId);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- --selectProjects unit -t "TaskRunCoordinator.isActive"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/TaskRunCoordinator.ts tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
git commit -m "feat(tasks): expose TaskRunCoordinator.isActive for queue eligibility"
```

---

### Task 7: Implement `QueueSlotTracker`

**Files:**
- Create: `src/features/tasks/execution/QueueSlotTracker.ts`
- Test: `tests/unit/features/tasks/execution/QueueSlotTracker.test.ts`

- [ ] **Step 1: Write the failing test suite**

Create `tests/unit/features/tasks/execution/QueueSlotTracker.test.ts`:

```typescript
import { QueueSlotTracker } from '../../../../../src/features/tasks/execution/QueueSlotTracker';

describe('QueueSlotTracker', () => {
  it('starts empty with the given capacity', () => {
    const t = new QueueSlotTracker(2);
    expect(t.capacity()).toBe(2);
    expect(t.occupied()).toBe(0);
    expect(t.hasFreeSlot()).toBe(true);
  });

  it('acquires up to capacity and refuses beyond', () => {
    const t = new QueueSlotTracker(2);
    expect(t.acquire('a')).toBe(true);
    expect(t.acquire('b')).toBe(true);
    expect(t.acquire('c')).toBe(false);
    expect(t.occupied()).toBe(2);
    expect(t.hasFreeSlot()).toBe(false);
  });

  it('refuses double-acquire of the same id', () => {
    const t = new QueueSlotTracker(2);
    expect(t.acquire('a')).toBe(true);
    expect(t.acquire('a')).toBe(false);
    expect(t.occupied()).toBe(1);
  });

  it('release frees a slot', () => {
    const t = new QueueSlotTracker(1);
    t.acquire('a');
    t.release('a');
    expect(t.occupied()).toBe(0);
    expect(t.hasFreeSlot()).toBe(true);
  });

  it('release for an unheld id is a no-op', () => {
    const t = new QueueSlotTracker(1);
    expect(() => t.release('ghost')).not.toThrow();
    expect(t.occupied()).toBe(0);
  });

  it('isHeld reflects current state', () => {
    const t = new QueueSlotTracker(2);
    t.acquire('a');
    expect(t.isHeld('a')).toBe(true);
    expect(t.isHeld('b')).toBe(false);
    t.release('a');
    expect(t.isHeld('a')).toBe(false);
  });

  it('setCap raises capacity without dropping in-flight', () => {
    const t = new QueueSlotTracker(1);
    t.acquire('a');
    t.setCap(3);
    expect(t.capacity()).toBe(3);
    expect(t.occupied()).toBe(1);
    expect(t.hasFreeSlot()).toBe(true);
  });

  it('setCap shrinking below occupied keeps in-flight; refuses new acquires', () => {
    const t = new QueueSlotTracker(3);
    t.acquire('a');
    t.acquire('b');
    t.acquire('c');
    t.setCap(1);
    expect(t.capacity()).toBe(1);
    expect(t.occupied()).toBe(3);
    expect(t.hasFreeSlot()).toBe(false);
    expect(t.acquire('d')).toBe(false);
    t.release('a');
    t.release('b');
    expect(t.hasFreeSlot()).toBe(false);
    t.release('c');
    expect(t.hasFreeSlot()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- --selectProjects unit -t "QueueSlotTracker"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the class**

Create `src/features/tasks/execution/QueueSlotTracker.ts`:

```typescript
export class QueueSlotTracker {
  private readonly held = new Set<string>();
  private cap: number;

  constructor(cap: number) {
    this.cap = Math.max(1, cap);
  }

  capacity(): number {
    return this.cap;
  }

  occupied(): number {
    return this.held.size;
  }

  hasFreeSlot(): boolean {
    return this.held.size < this.cap;
  }

  isHeld(taskId: string): boolean {
    return this.held.has(taskId);
  }

  acquire(taskId: string): boolean {
    if (!this.hasFreeSlot()) return false;
    if (this.held.has(taskId)) return false;
    this.held.add(taskId);
    return true;
  }

  release(taskId: string): void {
    this.held.delete(taskId);
  }

  setCap(next: number): void {
    this.cap = Math.max(1, next);
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- --selectProjects unit -t "QueueSlotTracker"`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/QueueSlotTracker.ts tests/unit/features/tasks/execution/QueueSlotTracker.test.ts
git commit -m "feat(tasks): add QueueSlotTracker for queue cap enforcement"
```

---

### Task 8: Implement `selectNextEligibleTask`

**Files:**
- Create: `src/features/tasks/execution/selectNextEligibleTask.ts`
- Test: `tests/unit/features/tasks/execution/selectNextEligibleTask.test.ts`

- [ ] **Step 1: Write the failing test suite**

Create `tests/unit/features/tasks/execution/selectNextEligibleTask.test.ts`:

```typescript
import { selectNextEligibleTask } from '../../../../../src/features/tasks/execution/selectNextEligibleTask';
import type { TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';

function makeTask(overrides: Partial<TaskSpec['frontmatter']> & { id: string }): TaskSpec {
  return {
    path: `tasks/${overrides.id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id: overrides.id,
      schema_version: 1,
      status: overrides.status ?? 'ready',
      priority: overrides.priority ?? '2 - normal',
      created: overrides.created ?? '2026-06-01T00:00:00Z',
      provider: overrides.provider ?? 'claude',
      model: overrides.model ?? 'claude-sonnet-4-5',
      title: overrides.id,
      attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

const allHealthy = {
  isProviderEnabled: () => true,
  ownsModel: () => true,
  isActive: () => false,
};

describe('selectNextEligibleTask', () => {
  it('returns null when no candidates exist', () => {
    expect(selectNextEligibleTask([], allHealthy, new Set())).toBeNull();
  });

  it('returns ok for the highest-priority ready candidate', () => {
    const tasks = [
      makeTask({ id: 'a', priority: '2 - normal' }),
      makeTask({ id: 'b', priority: '1 - high' }),
    ];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick?.kind).toBe('ok');
    expect(pick?.task.frontmatter.id).toBe('b');
  });

  it('honors created timestamp as tiebreaker', () => {
    const tasks = [
      makeTask({ id: 'a', created: '2026-06-02T00:00:00Z' }),
      makeTask({ id: 'b', created: '2026-06-01T00:00:00Z' }),
    ];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick?.task.frontmatter.id).toBe('b');
  });

  it('excludes ids in the excluded set', () => {
    const tasks = [
      makeTask({ id: 'a', priority: '1 - high' }),
      makeTask({ id: 'b', priority: '2 - normal' }),
    ];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set(['a']));
    expect(pick?.task.frontmatter.id).toBe('b');
  });

  it('excludes tasks already active in the coordinator', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    const pick = selectNextEligibleTask(
      tasks,
      { ...allHealthy, isActive: (id) => id === 'a' },
      new Set(),
    );
    expect(pick?.task.frontmatter.id).toBe('b');
  });

  it('returns skipped for disabled provider with stable reason', () => {
    const tasks = [makeTask({ id: 'a', provider: 'codex' })];
    const pick = selectNextEligibleTask(
      tasks,
      { ...allHealthy, isProviderEnabled: (id) => id !== 'codex' },
      new Set(),
    );
    expect(pick).toEqual({
      kind: 'skipped',
      task: tasks[0],
      reason: "provider 'codex' is disabled",
    });
  });

  it('returns skipped for unowned model', () => {
    const tasks = [makeTask({ id: 'a', model: 'gpt-7' })];
    const pick = selectNextEligibleTask(
      tasks,
      { ...allHealthy, ownsModel: (_p, m) => m !== 'gpt-7' },
      new Set(),
    );
    expect(pick).toEqual({
      kind: 'skipped',
      task: tasks[0],
      reason: "model 'gpt-7' is not available for provider 'claude'",
    });
  });

  it('returns skipped for missing provider', () => {
    const tasks = [makeTask({ id: 'a', provider: '' as never })];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick).toEqual({
      kind: 'skipped',
      task: tasks[0],
      reason: 'work order is missing provider',
    });
  });

  it('returns skipped for missing model', () => {
    const tasks = [makeTask({ id: 'a', model: '' as never })];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick).toEqual({
      kind: 'skipped',
      task: tasks[0],
      reason: 'work order is missing model',
    });
  });

  it('includes needs_fix as eligible status', () => {
    const tasks = [makeTask({ id: 'a', status: 'needs_fix' })];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick?.kind).toBe('ok');
  });

  it('ignores inbox and running statuses', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'inbox' }),
      makeTask({ id: 'b', status: 'running' }),
    ];
    expect(selectNextEligibleTask(tasks, allHealthy, new Set())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- --selectProjects unit -t "selectNextEligibleTask"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the selector**

Create `src/features/tasks/execution/selectNextEligibleTask.ts`:

```typescript
import { isRunnableTaskStatus } from '../model/taskStateMachine';
import type { TaskPriority, TaskSpec } from '../model/taskTypes';

export interface EligibilityPredicates {
  isProviderEnabled: (providerId: string) => boolean;
  ownsModel: (providerId: string, model: string) => boolean;
  isActive: (taskId: string) => boolean;
}

export type EligibilityResult =
  | { kind: 'ok'; task: TaskSpec }
  | { kind: 'skipped'; task: TaskSpec; reason: string };

function priorityRank(priority: TaskPriority): number {
  const rank = parseInt(priority, 10);
  return Number.isNaN(rank) ? Number.POSITIVE_INFINITY : rank;
}

export function selectNextEligibleTask(
  tasks: TaskSpec[],
  predicates: EligibilityPredicates,
  excluded: ReadonlySet<string>,
): EligibilityResult | null {
  const candidates = tasks.filter(
    (t) =>
      isRunnableTaskStatus(t.frontmatter.status) &&
      t.frontmatter.status !== 'running' &&
      !excluded.has(t.frontmatter.id) &&
      !predicates.isActive(t.frontmatter.id),
  );
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const byPriority = priorityRank(a.frontmatter.priority) - priorityRank(b.frontmatter.priority);
    if (byPriority !== 0) return byPriority;
    return a.frontmatter.created.localeCompare(b.frontmatter.created);
  });

  const task = sorted[0];
  const { provider, model } = task.frontmatter;
  if (!provider) return { kind: 'skipped', task, reason: 'work order is missing provider' };
  if (!model) return { kind: 'skipped', task, reason: 'work order is missing model' };
  if (!predicates.isProviderEnabled(provider)) {
    return { kind: 'skipped', task, reason: `provider '${provider}' is disabled` };
  }
  if (!predicates.ownsModel(provider, model)) {
    return { kind: 'skipped', task, reason: `model '${model}' is not available for provider '${provider}'` };
  }
  return { kind: 'ok', task };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- --selectProjects unit -t "selectNextEligibleTask"`
Expected: PASS (all 11 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/selectNextEligibleTask.ts tests/unit/features/tasks/execution/selectNextEligibleTask.test.ts
git commit -m "feat(tasks): add selectNextEligibleTask with skip-with-reason"
```

---

### Task 9: Scaffold `QueueRunner` — paused/halted gates

**Files:**
- Create: `src/features/tasks/execution/QueueRunner.ts`
- Test: `tests/unit/features/tasks/execution/QueueRunner.test.ts`

This task and the next three (10, 11, 12) build `QueueRunner` incrementally with TDD. Each adds one slice of behavior plus its tests.

- [ ] **Step 1: Write the failing test for paused gate**

Create `tests/unit/features/tasks/execution/QueueRunner.test.ts`:

```typescript
import { QueueRunner, type QueueRunnerDeps } from '../../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string, overrides: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id,
      schema_version: 1,
      status: 'ready',
      priority: '2 - normal',
      created: '2026-06-01T00:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      title: id,
      attempts: 0,
      ...overrides,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

interface TestHarness {
  runner: QueueRunner;
  slot: QueueSlotTracker;
  runCalls: string[];
  emissions: Array<{ name: string; payload: unknown }>;
  setTasks: (tasks: TaskSpec[]) => void;
}

function makeHarness(overrides: Partial<QueueRunnerDeps> = {}): TestHarness {
  const slot = new QueueSlotTracker(1);
  let tasks: TaskSpec[] = [];
  const runCalls: string[] = [];
  const emissions: Array<{ name: string; payload: unknown }> = [];
  const deps: QueueRunnerDeps = {
    slot,
    getTasks: () => tasks,
    eligibility: {
      isProviderEnabled: () => true,
      ownsModel: () => true,
      isActive: () => false,
    },
    coordinator: {
      run: async (task) => {
        runCalls.push(task.frontmatter.id);
        return { ok: true, status: 'review' };
      },
      isActive: () => false,
    },
    appendLedger: async () => {},
    events: {
      emit: (name: string, payload: unknown) => emissions.push({ name, payload }),
      on: () => () => {},
    },
    haltAfterFailures: 3,
    initialPaused: false,
    now: () => Date.now(),
    ...overrides,
  } as QueueRunnerDeps;
  const runner = new QueueRunner(deps);
  return { runner, slot, runCalls, emissions, setTasks: (t) => { tasks = t; } };
}

describe('QueueRunner — paused/halted gates', () => {
  it('does not tick when paused', async () => {
    const h = makeHarness({ initialPaused: true });
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runCalls).toEqual([]);
  });

  it('does not tick when halted', async () => {
    const h = makeHarness();
    h.runner.setHalted('test halt');
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runCalls).toEqual([]);
  });

  it('ticks when neither paused nor halted', async () => {
    const h = makeHarness();
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runCalls).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- --selectProjects unit -t "QueueRunner — paused/halted gates"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the runner scaffold**

Create `src/features/tasks/execution/QueueRunner.ts`:

```typescript
import type { TaskEventMap } from '../events';
import type { TaskLedgerEntry, TaskSpec } from '../model/taskTypes';
import type { EligibilityPredicates } from './selectNextEligibleTask';
import { selectNextEligibleTask } from './selectNextEligibleTask';
import type { TaskRunResult } from './TaskRunCoordinator';
import type { QueueSlotTracker } from './QueueSlotTracker';

export interface QueueRunnerEvents {
  emit<K extends keyof TaskEventMap>(name: K, payload: TaskEventMap[K]): void;
  on<K extends keyof TaskEventMap>(name: K, handler: (payload: TaskEventMap[K]) => void): () => void;
}

export interface QueueRunnerCoordinator {
  run(task: TaskSpec): Promise<TaskRunResult>;
  isActive(taskId: string): boolean;
}

export interface QueueRunnerDeps {
  slot: QueueSlotTracker;
  getTasks: () => TaskSpec[];
  eligibility: EligibilityPredicates;
  coordinator: QueueRunnerCoordinator;
  appendLedger: (task: TaskSpec, entry: TaskLedgerEntry) => Promise<void>;
  events: QueueRunnerEvents;
  haltAfterFailures: number;
  initialPaused: boolean;
  now: () => number;
}

interface QueueRunnerState {
  paused: boolean;
  halted: boolean;
  haltReason: string | null;
  consecutiveFailures: number;
  lastSkipReasonByTask: Map<string, { reason: string; at: number }>;
}

const SKIP_DEBOUNCE_MS = 60_000;

export class QueueRunner {
  private readonly state: QueueRunnerState;
  private pending = false;
  private running = false;
  private disposed = false;

  constructor(private readonly deps: QueueRunnerDeps) {
    this.state = {
      paused: deps.initialPaused,
      halted: false,
      haltReason: null,
      consecutiveFailures: 0,
      lastSkipReasonByTask: new Map(),
    };
  }

  isPaused(): boolean {
    return this.state.paused;
  }

  isHalted(): boolean {
    return this.state.halted;
  }

  setPaused(next: boolean): void {
    this.state.paused = next;
    if (next) {
      this.deps.events.emit('task:queue-paused', undefined as never);
    } else {
      this.deps.events.emit('task:queue-resumed', undefined as never);
      this.tick();
    }
  }

  setHalted(reason: string): void {
    this.state.halted = true;
    this.state.haltReason = reason;
    this.deps.events.emit('task:queue-halted', { reason });
  }

  clearHalt(): void {
    this.state.halted = false;
    this.state.haltReason = null;
    this.state.consecutiveFailures = 0;
  }

  dispose(): void {
    this.disposed = true;
  }

  tick(): void {
    if (this.disposed) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      void this.doTick();
    } finally {
      this.running = false;
      if (this.pending) {
        this.pending = false;
        queueMicrotask(() => this.tick());
      }
    }
  }

  private async doTick(): Promise<void> {
    if (this.state.paused || this.state.halted) return;
    const excluded = new Set<string>();
    while (this.deps.slot.hasFreeSlot()) {
      const pick = selectNextEligibleTask(this.deps.getTasks(), this.deps.eligibility, excluded);
      if (!pick) return;
      if (pick.kind === 'skipped') {
        this.recordSkip(pick.task, pick.reason);
        excluded.add(pick.task.frontmatter.id);
        continue;
      }
      this.launch(pick.task);
    }
  }

  private launch(task: TaskSpec): void {
    if (!this.deps.slot.acquire(task.frontmatter.id)) return;
    this.deps.events.emit('task:queue-tick', { taskId: task.frontmatter.id });
    this.deps.coordinator
      .run(task)
      .then((res) => this.onSettle(task, res))
      .catch((err) => this.onSettle(task, { ok: false, error: String(err) }))
      .finally(() => {
        this.deps.slot.release(task.frontmatter.id);
        this.tick();
      });
  }

  private onSettle(task: TaskSpec, res: TaskRunResult): void {
    if (!res.ok) {
      this.state.consecutiveFailures++;
      if (this.state.consecutiveFailures >= this.deps.haltAfterFailures) {
        const reason = `${this.state.consecutiveFailures} consecutive failures · last: ${res.error}`;
        this.setHalted(reason);
      }
    } else {
      this.state.consecutiveFailures = 0;
    }
  }

  private recordSkip(task: TaskSpec, reason: string): void {
    const now = this.deps.now();
    const prev = this.state.lastSkipReasonByTask.get(task.frontmatter.id);
    const shouldWrite = !prev || prev.reason !== reason || now - prev.at > SKIP_DEBOUNCE_MS;
    this.state.lastSkipReasonByTask.set(task.frontmatter.id, { reason, at: now });
    this.deps.events.emit('task:queue-skipped', { taskId: task.frontmatter.id, reason });
    if (shouldWrite) {
      void this.deps.appendLedger(task, {
        timestamp: new Date(now).toISOString(),
        status: 'ready',
        message: `queue: skipped (${reason})`,
      });
    }
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test -- --selectProjects unit -t "QueueRunner — paused/halted gates"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/QueueRunner.ts tests/unit/features/tasks/execution/QueueRunner.test.ts
git commit -m "feat(tasks): scaffold QueueRunner with paused/halted gates"
```

---

### Task 10: `QueueRunner` — skip-cascade + slot acquire path

**Files:**
- Modify: `tests/unit/features/tasks/execution/QueueRunner.test.ts`

- [ ] **Step 1: Append the failing tests**

In `tests/unit/features/tasks/execution/QueueRunner.test.ts`, add a new `describe`:

```typescript
describe('QueueRunner — skip-cascade', () => {
  it('drains skips in a single tick and launches the next eligible card', async () => {
    const h = makeHarness({
      eligibility: {
        isProviderEnabled: (id) => id === 'claude',
        ownsModel: () => true,
        isActive: () => false,
      },
    });
    h.setTasks([
      makeTask('a', { provider: 'codex' }),
      makeTask('b', { provider: 'codex' }),
      makeTask('c'),
    ]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runCalls).toEqual(['c']);
    const skipped = h.emissions.filter((e) => e.name === 'task:queue-skipped').map((e) => (e.payload as { taskId: string }).taskId);
    expect(skipped).toEqual(['a', 'b']);
  });

  it('emits task:queue-tick when launching', async () => {
    const h = makeHarness();
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    const ticks = h.emissions.filter((e) => e.name === 'task:queue-tick');
    expect(ticks).toHaveLength(1);
    expect(ticks[0].payload).toEqual({ taskId: 'a' });
  });

  it('refuses to launch beyond cap', async () => {
    const h = makeHarness();
    h.setTasks([makeTask('a'), makeTask('b')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runCalls).toEqual(['a', 'b']);
  });

  it('launches up to cap concurrently when cap > 1', async () => {
    const slot = new QueueSlotTracker(2);
    let hold!: (value: void) => void;
    const holdRun = new Promise<void>((res) => { hold = res; });
    const runCalls: string[] = [];
    const h = makeHarness({
      slot,
      coordinator: {
        run: async (task) => {
          runCalls.push(task.frontmatter.id);
          await holdRun;
          return { ok: true, status: 'review' };
        },
        isActive: () => false,
      },
    });
    h.setTasks([makeTask('a'), makeTask('b'), makeTask('c')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(runCalls).toEqual(['a', 'b']);
    expect(slot.occupied()).toBe(2);
    hold();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(runCalls).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- --selectProjects unit -t "QueueRunner — skip-cascade"`
Expected: PASS (already covered by the Task 9 implementation; this task is a coverage extension).

If anything fails, the runner code from Task 9 has a defect — fix it in `QueueRunner.ts`. Do not skip a failing test.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/features/tasks/execution/QueueRunner.test.ts
git commit -m "test(tasks): cover QueueRunner skip-cascade and cap-bound launching"
```

---

### Task 11: `QueueRunner` — halt threshold + counter behavior

**Files:**
- Modify: `tests/unit/features/tasks/execution/QueueRunner.test.ts`

- [ ] **Step 1: Append the failing tests**

```typescript
describe('QueueRunner — halt threshold', () => {
  it('halts after N consecutive failures', async () => {
    const h = makeHarness({
      haltAfterFailures: 2,
      coordinator: {
        run: async () => ({ ok: false, error: 'boom' }),
        isActive: () => false,
      },
    });
    h.setTasks([makeTask('a'), makeTask('b'), makeTask('c')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runner.isHalted()).toBe(true);
    const halted = h.emissions.filter((e) => e.name === 'task:queue-halted');
    expect(halted).toHaveLength(1);
  });

  it('resets counter on success', async () => {
    let count = 0;
    const h = makeHarness({
      haltAfterFailures: 3,
      coordinator: {
        run: async () => {
          count++;
          return count === 2 ? { ok: true, status: 'review' } : { ok: false, error: 'boom' };
        },
        isActive: () => false,
      },
    });
    h.setTasks([makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')]);
    h.runner.tick();
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.runner.isHalted()).toBe(false);
  });

  it('clearHalt resets state and lets next tick run', async () => {
    const h = makeHarness({
      haltAfterFailures: 1,
      coordinator: {
        run: async () => ({ ok: false, error: 'boom' }),
        isActive: () => false,
      },
    });
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runner.isHalted()).toBe(true);
    h.runner.clearHalt();
    expect(h.runner.isHalted()).toBe(false);
  });
});

describe('QueueRunner — pause/resume', () => {
  it('setPaused(true) emits paused event and blocks ticks', async () => {
    const h = makeHarness();
    h.setTasks([makeTask('a')]);
    h.runner.setPaused(true);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runCalls).toEqual([]);
    expect(h.emissions.some((e) => e.name === 'task:queue-paused')).toBe(true);
  });

  it('setPaused(false) emits resumed event and ticks immediately', async () => {
    const h = makeHarness({ initialPaused: true });
    h.setTasks([makeTask('a')]);
    h.runner.setPaused(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runCalls).toEqual(['a']);
    expect(h.emissions.some((e) => e.name === 'task:queue-resumed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- --selectProjects unit -t "QueueRunner — halt threshold"`
Run: `npm run test -- --selectProjects unit -t "QueueRunner — pause/resume"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/features/tasks/execution/QueueRunner.test.ts
git commit -m "test(tasks): cover QueueRunner halt threshold and pause/resume"
```

---

### Task 12: `QueueRunner` — skip ledger debounce + dispose

**Files:**
- Modify: `tests/unit/features/tasks/execution/QueueRunner.test.ts`

- [ ] **Step 1: Append the failing tests**

```typescript
describe('QueueRunner — skip ledger debounce', () => {
  it('writes the ledger entry once per 60s for the same (task, reason)', async () => {
    let nowMs = 1_000_000;
    const ledger: Array<{ task: string; message: string }> = [];
    const h = makeHarness({
      eligibility: {
        isProviderEnabled: () => false,
        ownsModel: () => true,
        isActive: () => false,
      },
      appendLedger: async (task, entry) => {
        ledger.push({ task: task.frontmatter.id, message: entry.message });
      },
      now: () => nowMs,
    });
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger).toHaveLength(1);

    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger).toHaveLength(1);

    nowMs += 60_001;
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger).toHaveLength(2);
  });

  it('writes a fresh ledger entry when the reason changes', async () => {
    let providerEnabled = false;
    const ledger: Array<{ task: string; message: string }> = [];
    const h = makeHarness({
      eligibility: {
        isProviderEnabled: () => providerEnabled,
        ownsModel: () => false,
        isActive: () => false,
      },
      appendLedger: async (task, entry) => {
        ledger.push({ task: task.frontmatter.id, message: entry.message });
      },
    });
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger).toHaveLength(1);

    providerEnabled = true;
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger).toHaveLength(2);
    expect(ledger[1].message).toContain('model');
  });
});

describe('QueueRunner — dispose', () => {
  it('dispose prevents further ticks', async () => {
    const h = makeHarness();
    h.runner.dispose();
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.runCalls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- --selectProjects unit -t "QueueRunner — skip ledger debounce"`
Run: `npm run test -- --selectProjects unit -t "QueueRunner — dispose"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/features/tasks/execution/QueueRunner.test.ts
git commit -m "test(tasks): cover QueueRunner skip debounce and dispose"
```

---

### Task 13: Wire `QueueSlotTracker` singleton in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Locate where `TaskRunCoordinator` or `AgentBoardView` is constructed**

Search the file for `TaskRunCoordinator` and `AgentBoardView`. There is a factory or registration where the view is created. Identify the right wiring spot.

Run: `grep -n "AgentBoardView\|TaskRunCoordinator\|registerView" src/main.ts`

- [ ] **Step 2: Construct the shared `QueueSlotTracker`**

In `src/main.ts`, near the plugin-level service construction (top of `onload` or in a setup method), add:

```typescript
import { QueueSlotTracker } from './features/tasks/execution/QueueSlotTracker';

// inside onload(), near other plugin-level services:
this.queueSlotTracker = new QueueSlotTracker(this.settings.agentBoardQueueCap);
```

Add the property on the class:

```typescript
queueSlotTracker!: QueueSlotTracker;
```

- [ ] **Step 3: Update the slot tracker when settings change**

Find the existing `saveSettings()` method. After saving, sync the cap:

```typescript
async saveSettings(): Promise<void> {
  // existing save logic...
  this.queueSlotTracker?.setCap(this.settings.agentBoardQueueCap);
}
```

- [ ] **Step 4: Pass the tracker into `AgentBoardView` construction**

Locate where `AgentBoardView` is instantiated (search for `new AgentBoardView`). Pass the tracker through. If it's constructed via `registerView` with a factory, add the tracker as a constructor argument.

This requires updating `AgentBoardView`'s constructor signature in Task 14 — defer the consumption side there. For now, ensure `main.ts` exposes `this.queueSlotTracker` so the view can read it.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(tasks): construct shared QueueSlotTracker on plugin load"
```

---

### Task 14: `AgentBoardView` mounts `QueueRunner`

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [ ] **Step 1: Import dependencies**

At the top of `src/features/tasks/ui/AgentBoardView.ts`:

```typescript
import { QueueRunner } from '../execution/QueueRunner';
import { writeBoardQueuePaused } from '../config/BoardConfigStore';
```

- [ ] **Step 2: Add the runner field**

Add a private field on the class:

```typescript
private runner: QueueRunner | null = null;
```

- [ ] **Step 3: Construct the runner in `refresh()`**

The `refresh()` method already loads board config. After `this.config = config` (around line 80), construct or update the runner. Add a private method:

```typescript
private syncRunner(): void {
  const paused = this.config.queue?.paused ?? false;
  if (!this.runner) {
    this.runner = new QueueRunner({
      slot: this.plugin.queueSlotTracker,
      getTasks: () => this.model.tasks,
      eligibility: {
        isProviderEnabled: (id) => this.plugin.providerRegistry.isEnabled(id),
        ownsModel: (providerId, model) => this.plugin.providerRegistry.ownsModel(providerId, model),
        isActive: (id) => this.coordinator.isActive(id),
      },
      coordinator: this.coordinator,
      appendLedger: (task, entry) => this.noteStore.appendLedger(task, entry),
      events: this.plugin.events,
      haltAfterFailures: this.plugin.settings.agentBoardQueueHaltAfter,
      initialPaused: paused,
      now: () => Date.now(),
    });
  } else {
    if (this.runner.isPaused() !== paused) this.runner.setPaused(paused);
  }
  this.runner.tick();
}
```

The exact `providerRegistry.isEnabled` / `ownsModel` names should be checked against the actual API; replace with the methods used by `TaskRunCoordinator` today (`isProviderEnabled` / `ownsModel`). Inject them via the same predicate the coordinator already takes if cleaner.

The `this.coordinator` field needs construction — if `AgentBoardView` does not own a `TaskRunCoordinator` today, look at how `runTask` currently runs work orders (search for `runTask` and trace). Reuse the same coordinator instance.

Call `syncRunner()` from `refresh()` after `this.layout = ...`:

```typescript
this.syncRunner();
```

- [ ] **Step 4: Dispose the runner on close**

In `onClose`:

```typescript
async onClose(): Promise<void> {
  this.runner?.dispose();
  this.runner = null;
  if (this.refreshTimer !== null) {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
```

- [ ] **Step 5: Subscribe to status-changed for tick fanout**

In `onOpen`, after the existing event subscriptions, add:

```typescript
this.register(this.plugin.events.on('task:status-changed', () => this.runner?.tick()));
this.register(this.plugin.events.on('task:run-finished', () => this.runner?.tick()));
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. Fix any type mismatches inline (e.g., predicate names).

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat(tasks): mount QueueRunner per AgentBoardView with event fanout"
```

---

### Task 15: Toolbar render in `AgentBoardRenderer`

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Test: `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` in `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts` (create the file if missing — follow patterns from other UI renderer tests):

```typescript
import { AgentBoardRenderer } from '../../../../../src/features/tasks/ui/AgentBoardRenderer';

describe('AgentBoardRenderer — queue toolbar', () => {
  it('renders the toolbar toggle in running state by default', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    renderer.renderToolbar(host, {
      paused: false,
      halted: false,
      slotOccupied: 0,
      slotCapacity: 1,
      consecutiveFailures: 0,
      onToggle: () => {},
    });
    const toggle = host.querySelector('.claudian-agent-board-toolbar--queue-toggle');
    expect(toggle?.textContent).toContain('Queue');
    expect(host.querySelector('.claudian-agent-board-toolbar--queue-active-count')?.textContent).toContain('0/1');
  });

  it('renders failure counter when > 0', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    renderer.renderToolbar(host, {
      paused: false,
      halted: false,
      slotOccupied: 0,
      slotCapacity: 1,
      consecutiveFailures: 2,
      onToggle: () => {},
    });
    expect(host.querySelector('.claudian-agent-board-toolbar--queue-failure-count')?.textContent).toContain('2');
  });

  it('invokes the toggle callback on click', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    let clicked = false;
    renderer.renderToolbar(host, {
      paused: false,
      halted: false,
      slotOccupied: 0,
      slotCapacity: 1,
      consecutiveFailures: 0,
      onToggle: () => { clicked = true; },
    });
    (host.querySelector('.claudian-agent-board-toolbar--queue-toggle') as HTMLButtonElement)?.click();
    expect(clicked).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- --selectProjects unit -t "AgentBoardRenderer — queue toolbar"`
Expected: FAIL (method not found).

- [ ] **Step 3: Implement `renderToolbar`**

In `src/features/tasks/ui/AgentBoardRenderer.ts`, add a public method:

```typescript
export interface QueueToolbarState {
  paused: boolean;
  halted: boolean;
  slotOccupied: number;
  slotCapacity: number;
  consecutiveFailures: number;
  onToggle: () => void;
}

// inside AgentBoardRenderer:
renderToolbar(host: HTMLElement, state: QueueToolbarState): void {
  host.empty?.();
  while (host.firstChild) host.removeChild(host.firstChild);
  const bar = host.createDiv ? host.createDiv({ cls: 'claudian-agent-board-toolbar' }) : (() => {
    const d = document.createElement('div');
    d.className = 'claudian-agent-board-toolbar';
    host.appendChild(d);
    return d;
  })();

  const toggle = document.createElement('button');
  toggle.className = 'claudian-agent-board-toolbar--queue-toggle';
  toggle.textContent = state.paused || state.halted ? '▶ Queue' : '⏸ Queue';
  if (state.halted) toggle.classList.add('claudian-agent-board-toolbar--queue-toggle-halted');
  toggle.addEventListener('click', () => state.onToggle());
  bar.appendChild(toggle);

  const counts = document.createElement('span');
  counts.className = 'claudian-agent-board-toolbar--queue-active-count';
  counts.textContent = `${state.slotOccupied}/${state.slotCapacity} active`;
  bar.appendChild(counts);

  if (state.consecutiveFailures > 0) {
    const fc = document.createElement('span');
    fc.className = 'claudian-agent-board-toolbar--queue-failure-count';
    fc.textContent = `· ${state.consecutiveFailures} failures`;
    bar.appendChild(fc);
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test -- --selectProjects unit -t "AgentBoardRenderer — queue toolbar"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ui/AgentBoardRenderer.ts tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts
git commit -m "feat(tasks): render queue toolbar toggle + counts"
```

---

### Task 16: Halt banner render

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Modify: `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `AgentBoardRenderer.test.ts`:

```typescript
describe('AgentBoardRenderer — halt banner', () => {
  it('renders the banner with reason and resume action when halted', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    let resumed = false;
    renderer.renderHaltBanner(host, {
      reason: '3 consecutive failures · last: boom',
      onResume: () => { resumed = true; },
      onOpenFailed: () => {},
    });
    expect(host.querySelector('.claudian-agent-board-banner-halt')?.textContent).toContain('halted');
    expect(host.textContent).toContain('boom');
    (host.querySelector('.claudian-agent-board-banner-halt--resume') as HTMLButtonElement)?.click();
    expect(resumed).toBe(true);
  });

  it('renders nothing when reason is null', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    renderer.renderHaltBanner(host, { reason: null, onResume: () => {}, onOpenFailed: () => {} });
    expect(host.querySelector('.claudian-agent-board-banner-halt')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- --selectProjects unit -t "AgentBoardRenderer — halt banner"`
Expected: FAIL.

- [ ] **Step 3: Implement `renderHaltBanner`**

```typescript
export interface HaltBannerState {
  reason: string | null;
  onResume: () => void;
  onOpenFailed: () => void;
}

// inside AgentBoardRenderer:
renderHaltBanner(host: HTMLElement, state: HaltBannerState): void {
  while (host.firstChild) host.removeChild(host.firstChild);
  if (!state.reason) return;
  const banner = document.createElement('div');
  banner.className = 'claudian-agent-board-banner-halt';
  const title = document.createElement('div');
  title.textContent = `⚠ Queue halted: ${state.reason}`;
  banner.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'claudian-agent-board-banner-halt--actions';

  const resume = document.createElement('button');
  resume.className = 'claudian-agent-board-banner-halt--resume';
  resume.textContent = 'Resume queue';
  resume.addEventListener('click', () => state.onResume());
  actions.appendChild(resume);

  const open = document.createElement('button');
  open.className = 'claudian-agent-board-banner-halt--open-failed';
  open.textContent = 'Open failed cards';
  open.addEventListener('click', () => state.onOpenFailed());
  actions.appendChild(open);

  banner.appendChild(actions);
  host.appendChild(banner);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test -- --selectProjects unit -t "AgentBoardRenderer — halt banner"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ui/AgentBoardRenderer.ts tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts
git commit -m "feat(tasks): render queue halt banner with resume action"
```

---

### Task 17: Skip-chip render

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Modify: `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('AgentBoardRenderer — skip chip', () => {
  it('renders the chip with reason text when reason is set', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    let acked = false;
    renderer.renderSkipChip(host, { reason: "provider 'codex' is disabled", onAck: () => { acked = true; } });
    const chip = host.querySelector('.claudian-agent-board-card-skip-chip');
    expect(chip?.textContent).toContain("provider 'codex' is disabled");
    (chip as HTMLElement)?.click();
    expect(acked).toBe(true);
  });

  it('renders nothing when reason is null', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    renderer.renderSkipChip(host, { reason: null, onAck: () => {} });
    expect(host.querySelector('.claudian-agent-board-card-skip-chip')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- --selectProjects unit -t "AgentBoardRenderer — skip chip"`
Expected: FAIL.

- [ ] **Step 3: Implement `renderSkipChip`**

```typescript
export interface SkipChipState {
  reason: string | null;
  onAck: () => void;
}

renderSkipChip(host: HTMLElement, state: SkipChipState): void {
  while (host.firstChild) host.removeChild(host.firstChild);
  if (!state.reason) return;
  const chip = document.createElement('div');
  chip.className = 'claudian-agent-board-card-skip-chip';
  chip.textContent = `⊘ Queue skipped: ${state.reason}`;
  chip.addEventListener('click', () => state.onAck());
  host.appendChild(chip);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test -- --selectProjects unit -t "AgentBoardRenderer — skip chip"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ui/AgentBoardRenderer.ts tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts
git commit -m "feat(tasks): render per-card queue skip chip"
```

---

### Task 18: Wire toolbar + banner + chip in `AgentBoardView`

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [ ] **Step 1: Mount the toolbar inside `render()`**

Find the `render()` method on `AgentBoardView` (private method that paints the board). At the top of the render output, before the lanes, add a toolbar host. If `render()` builds DOM imperatively, the easiest spot is right after `containerEl.empty()`.

```typescript
// inside render():
const toolbarHost = this.contentEl.createDiv({ cls: 'claudian-agent-board-toolbar-host' });
this.renderer.renderToolbar(toolbarHost, {
  paused: this.runner?.isPaused() ?? false,
  halted: this.runner?.isHalted() ?? false,
  slotOccupied: this.plugin.queueSlotTracker.occupied(),
  slotCapacity: this.plugin.queueSlotTracker.capacity(),
  consecutiveFailures: this.runner ? (this.runner as unknown as { state: { consecutiveFailures: number } }).state.consecutiveFailures : 0,
  onToggle: () => this.onToggleQueue(),
});

const bannerHost = this.contentEl.createDiv({ cls: 'claudian-agent-board-banner-host' });
this.renderer.renderHaltBanner(bannerHost, {
  reason: (this.runner as unknown as { state: { haltReason: string | null } } | null)?.state.haltReason ?? null,
  onResume: () => this.onResumeQueue(),
  onOpenFailed: () => this.onOpenFailedCards(),
});
```

The `state` access via cast is a code smell — clean fix: expose `getCounters()`/`getHaltReason()` getters on `QueueRunner` instead. Add these to `QueueRunner.ts`:

```typescript
getConsecutiveFailures(): number {
  return this.state.consecutiveFailures;
}

getHaltReason(): string | null {
  return this.state.haltReason;
}
```

Then use the clean getters in `AgentBoardView`.

- [ ] **Step 2: Add the toolbar callbacks**

Inside `AgentBoardView`:

```typescript
private async onToggleQueue(): Promise<void> {
  if (!this.runner) return;
  if (this.runner.isHalted()) {
    this.runner.clearHalt();
  }
  const next = !this.runner.isPaused();
  try {
    writeBoardQueuePaused(this.plugin.settings as unknown as Record<string, unknown>, next);
    await this.plugin.saveSettings();
    this.runner.setPaused(next);
    void this.refresh();
  } catch (err) {
    new Notice('Failed to save queue state.');
  }
}

private onResumeQueue(): void {
  this.runner?.clearHalt();
  this.runner?.setPaused(false);
  void this.refresh();
}

private onOpenFailedCards(): void {
  // hook into existing filter system; placeholder: refresh
  void this.refresh();
}
```

- [ ] **Step 3: Subscribe to queue events to refresh UI**

In `onOpen`:

```typescript
this.register(this.plugin.events.on('task:queue-paused', () => this.refresh()));
this.register(this.plugin.events.on('task:queue-resumed', () => this.refresh()));
this.register(this.plugin.events.on('task:queue-halted', () => this.refresh()));
this.register(this.plugin.events.on('task:queue-tick', () => this.refresh()));
this.register(this.plugin.events.on('task:queue-skipped', () => this.refresh()));
```

(A future plan can replace `refresh()` with finer-grained patch calls — this plan stays correct-first.)

- [ ] **Step 4: Wire skip chips into card render**

Find where each card is rendered inside `render()`. After the existing card content, look up the skip reason and call `renderSkipChip`:

```typescript
// inside per-card render loop:
const skipReason = this.runner?.getSkipReason(task.frontmatter.id) ?? null;
const chipHost = cardEl.createDiv();
this.renderer.renderSkipChip(chipHost, {
  reason: skipReason,
  onAck: () => {
    this.runner?.clearSkipReason(task.frontmatter.id);
    void this.refresh();
  },
});
```

Add the helpers to `QueueRunner.ts`:

```typescript
getSkipReason(taskId: string): string | null {
  return this.state.lastSkipReasonByTask.get(taskId)?.reason ?? null;
}

clearSkipReason(taskId: string): void {
  this.state.lastSkipReasonByTask.delete(taskId);
}
```

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Fix any inline.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts src/features/tasks/execution/QueueRunner.ts
git commit -m "feat(tasks): wire queue toolbar, halt banner, and skip chips into AgentBoardView"
```

---

### Task 19: Sync runner with settings changes (cap + halt threshold)

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [ ] **Step 1: Subscribe to the settings-changed event**

If `ClaudianSettings` emits an event on save (search `src/features/settings/events.ts`), subscribe in `onOpen`:

```typescript
this.register(this.plugin.events.on('settings:changed', () => {
  this.plugin.queueSlotTracker.setCap(this.plugin.settings.agentBoardQueueCap);
  this.runner?.tick();
}));
```

If no such event exists, fall back to syncing on every `refresh()` (cheap):

```typescript
// inside refresh():
this.plugin.queueSlotTracker.setCap(this.plugin.settings.agentBoardQueueCap);
```

For the halt-after-failures setting, the runner reads it from its `deps`. Since it's captured at construction time, expose a setter:

In `QueueRunner.ts`:

```typescript
setHaltAfterFailures(next: number): void {
  // store on deps clone or move into state
  (this.deps as { haltAfterFailures: number }).haltAfterFailures = Math.max(1, next);
}
```

Call it in `syncRunner()`:

```typescript
this.runner.setHaltAfterFailures(this.plugin.settings.agentBoardQueueHaltAfter);
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts src/features/tasks/execution/QueueRunner.ts
git commit -m "feat(tasks): sync queue cap and halt threshold on settings change"
```

---

### Task 20: CSS — toolbar, banner, skip chip

**Files:**
- Modify: `src/style/tasks/_agent-board.css`

- [ ] **Step 1: Append the new selectors**

Open `src/style/tasks/_agent-board.css`. Append at the end (or in a "Queue" subsection):

```css
/* Queue toolbar */
.claudian-agent-board-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.claudian-agent-board-toolbar--queue-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-normal);
}

.claudian-agent-board-toolbar--queue-toggle-halted::after {
  content: '●';
  color: var(--text-error);
  margin-left: 4px;
}

.claudian-agent-board-toolbar--queue-active-count,
.claudian-agent-board-toolbar--queue-failure-count {
  color: var(--text-muted);
  font-size: 0.85em;
}

.claudian-agent-board-toolbar--queue-failure-count {
  color: var(--text-error);
}

/* Halt banner */
.claudian-agent-board-banner-halt {
  background: var(--background-modifier-error);
  border: 1px solid var(--text-error);
  border-radius: 4px;
  padding: 8px 12px;
  margin: 8px 10px;
  color: var(--text-on-accent);
}

.claudian-agent-board-banner-halt--actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.claudian-agent-board-banner-halt--resume,
.claudian-agent-board-banner-halt--open-failed {
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 3px;
  padding: 3px 8px;
  cursor: pointer;
  color: var(--text-normal);
}

/* Skip chip */
.claudian-agent-board-card-skip-chip {
  display: inline-block;
  padding: 2px 6px;
  margin-top: 6px;
  background: var(--background-modifier-border);
  border-radius: 3px;
  font-size: 0.78em;
  color: var(--text-muted);
  cursor: pointer;
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS (CSS is bundled by the build step).

- [ ] **Step 3: Commit**

```bash
git add src/style/tasks/_agent-board.css
git commit -m "feat(tasks): style queue toolbar, halt banner, and skip chip"
```

---

### Task 21: Integration — basic drain

**Files:**
- Test: `tests/integration/features/tasks/queueRunner.basicDrain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/features/tasks/queueRunner.basicDrain.test.ts`:

```typescript
import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string, priority = '2 - normal', created = '2026-06-01T00:00:00Z'): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id,
      schema_version: 1,
      status: 'ready',
      priority,
      created,
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      title: id,
      attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

describe('QueueRunner integration — basic drain (cap=1)', () => {
  it('drains three ready cards in priority then created order', async () => {
    const slot = new QueueSlotTracker(1);
    const runOrder: string[] = [];
    let tasks: TaskSpec[] = [
      makeTask('a', '2 - normal', '2026-06-01T01:00:00Z'),
      makeTask('b', '1 - high', '2026-06-01T02:00:00Z'),
      makeTask('c', '2 - normal', '2026-06-01T00:30:00Z'),
    ];
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: {
        isProviderEnabled: () => true,
        ownsModel: () => true,
        isActive: () => false,
      },
      coordinator: {
        run: async (task) => {
          runOrder.push(task.frontmatter.id);
          tasks = tasks.filter((t) => t.frontmatter.id !== task.frontmatter.id);
          return { ok: true, status: 'review' };
        },
        isActive: () => false,
      },
      appendLedger: async () => {},
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runOrder).toEqual(['b', 'c', 'a']);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- --selectProjects integration -t "queueRunner integration — basic drain"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tasks/queueRunner.basicDrain.test.ts
git commit -m "test(tasks): integration test for queue basic drain"
```

---

### Task 22: Integration — hold slot on pause

**Files:**
- Test: `tests/integration/features/tasks/queueRunner.holdSlotOnPause.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec, TaskStatus } from '../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string, status: TaskStatus = 'ready'): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id,
      schema_version: 1,
      status,
      priority: '2 - normal',
      created: '2026-06-01T00:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      title: id,
      attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

describe('QueueRunner integration — hold slot on pause', () => {
  it('does not launch a second card while the first is paused', async () => {
    const slot = new QueueSlotTracker(1);
    const runCalls: string[] = [];
    let releaseA!: () => void;
    const aRun = new Promise<void>((res) => { releaseA = res; });
    const tasks = [makeTask('a'), makeTask('b')];
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: {
        isProviderEnabled: () => true,
        ownsModel: () => true,
        isActive: (id) => slot.isHeld(id),
      },
      coordinator: {
        run: async (task) => {
          runCalls.push(task.frontmatter.id);
          if (task.frontmatter.id === 'a') {
            // simulate needs_input mid-run by never resolving; release later
            await aRun;
          }
          return { ok: true, status: 'review' };
        },
        isActive: (id) => slot.isHeld(id),
      },
      appendLedger: async () => {},
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runCalls).toEqual(['a']);
    expect(slot.occupied()).toBe(1);

    runner.tick();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runCalls).toEqual(['a']);

    releaseA();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runCalls).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- --selectProjects integration -t "QueueRunner integration — hold slot on pause"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tasks/queueRunner.holdSlotOnPause.test.ts
git commit -m "test(tasks): integration test for slot-hold-on-pause"
```

---

### Task 23: Integration — halt after consecutive failures + clear

**Files:**
- Test: `tests/integration/features/tasks/queueRunner.haltAfterFailures.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id, schema_version: 1, status: 'ready', priority: '2 - normal',
      created: '2026-06-01T00:00:00Z', provider: 'claude',
      model: 'claude-sonnet-4-5', title: id, attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

describe('QueueRunner integration — halt after failures', () => {
  it('halts after 3 consecutive failures, resumes on clearHalt', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    let nextOk = false;
    let tasks = [makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')];
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: {
        isProviderEnabled: () => true,
        ownsModel: () => true,
        isActive: (id) => slot.isHeld(id),
      },
      coordinator: {
        run: async (task) => {
          runs.push(task.frontmatter.id);
          tasks = tasks.filter((t) => t.frontmatter.id !== task.frontmatter.id);
          return nextOk ? { ok: true, status: 'review' } : { ok: false, error: 'boom' };
        },
        isActive: (id) => slot.isHeld(id),
      },
      appendLedger: async () => {},
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual(['a', 'b', 'c']);
    expect(runner.isHalted()).toBe(true);

    nextOk = true;
    runner.clearHalt();
    runner.tick();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual(['a', 'b', 'c', 'd']);
    expect(runner.isHalted()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- --selectProjects integration -t "QueueRunner integration — halt after failures"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tasks/queueRunner.haltAfterFailures.test.ts
git commit -m "test(tasks): integration test for halt-after-failures and clear"
```

---

### Task 24: Integration — skip ineligible + chip + ledger debounce

**Files:**
- Test: `tests/integration/features/tasks/queueRunner.skipIneligible.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string, provider = 'claude'): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id, schema_version: 1, status: 'ready', priority: '2 - normal',
      created: '2026-06-01T00:00:00Z', provider,
      model: 'claude-sonnet-4-5', title: id, attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

describe('QueueRunner integration — skip ineligible', () => {
  it('skips disabled-provider cards and runs the next eligible', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    const ledger: string[] = [];
    const skipped: string[] = [];
    let tasks = [makeTask('a', 'codex'), makeTask('b')];
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: {
        isProviderEnabled: (id) => id !== 'codex',
        ownsModel: () => true,
        isActive: (id) => slot.isHeld(id),
      },
      coordinator: {
        run: async (task) => {
          runs.push(task.frontmatter.id);
          tasks = tasks.filter((t) => t.frontmatter.id !== task.frontmatter.id);
          return { ok: true, status: 'review' };
        },
        isActive: (id) => slot.isHeld(id),
      },
      appendLedger: async (task, entry) => { ledger.push(`${task.frontmatter.id}:${entry.message}`); },
      events: {
        emit: (name, payload) => {
          if (name === 'task:queue-skipped') skipped.push((payload as { taskId: string }).taskId);
        },
        on: () => () => {},
      },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual(['b']);
    expect(skipped).toEqual(['a']);
    expect(ledger).toEqual(["a:queue: skipped (provider 'codex' is disabled)"]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- --selectProjects integration -t "QueueRunner integration — skip ineligible"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tasks/queueRunner.skipIneligible.test.ts
git commit -m "test(tasks): integration test for skip-ineligible with ledger entry"
```

---

### Task 25: Integration — cap-change live + two-board shared cap

**Files:**
- Test: `tests/integration/features/tasks/queueRunner.capChangeLive.test.ts`
- Test: `tests/integration/features/tasks/queueRunner.twoBoardsShareCap.test.ts`

- [ ] **Step 1: Write the cap-change-live test**

```typescript
// queueRunner.capChangeLive.test.ts
import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id, schema_version: 1, status: 'ready', priority: '2 - normal',
      created: '2026-06-01T00:00:00Z', provider: 'claude',
      model: 'claude-sonnet-4-5', title: id, attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

describe('QueueRunner integration — cap change live', () => {
  it('opens slots when cap is raised mid-run', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    let release!: () => void;
    const block = new Promise<void>((r) => { release = r; });
    let tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: { isProviderEnabled: () => true, ownsModel: () => true, isActive: (id) => slot.isHeld(id) },
      coordinator: {
        run: async (task) => {
          runs.push(task.frontmatter.id);
          if (task.frontmatter.id === 'a') await block;
          tasks = tasks.filter((t) => t.frontmatter.id !== task.frontmatter.id);
          return { ok: true, status: 'review' };
        },
        isActive: (id) => slot.isHeld(id),
      },
      appendLedger: async () => {},
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual(['a']);

    slot.setCap(3);
    runner.tick();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runs.slice().sort()).toEqual(['a', 'b', 'c']);

    release();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
});
```

- [ ] **Step 2: Write the two-board shared-cap test**

```typescript
// queueRunner.twoBoardsShareCap.test.ts
import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id, schema_version: 1, status: 'ready', priority: '2 - normal',
      created: '2026-06-01T00:00:00Z', provider: 'claude',
      model: 'claude-sonnet-4-5', title: id, attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

describe('QueueRunner integration — two boards share cap', () => {
  it('cap=1 across two boards lets only one run start', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    let release!: () => void;
    const block = new Promise<void>((r) => { release = r; });
    const boardATasks = [makeTask('a')];
    const boardBTasks = [makeTask('b')];
    const sharedCoord = {
      run: async (task: TaskSpec) => {
        runs.push(task.frontmatter.id);
        await block;
        return { ok: true, status: 'review' as const };
      },
      isActive: (id: string) => slot.isHeld(id),
    };
    const mkRunner = (getTasks: () => TaskSpec[]) =>
      new QueueRunner({
        slot,
        getTasks,
        eligibility: { isProviderEnabled: () => true, ownsModel: () => true, isActive: (id) => slot.isHeld(id) },
        coordinator: sharedCoord,
        appendLedger: async () => {},
        events: { emit: () => {}, on: () => () => {} },
        haltAfterFailures: 3,
        initialPaused: false,
        now: () => Date.now(),
      });
    const ra = mkRunner(() => boardATasks);
    const rb = mkRunner(() => boardBTasks);
    ra.tick();
    rb.tick();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runs).toHaveLength(1);
    release();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm run test -- --selectProjects integration -t "QueueRunner integration — cap change live"`
Run: `npm run test -- --selectProjects integration -t "QueueRunner integration — two boards share cap"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/features/tasks/queueRunner.capChangeLive.test.ts tests/integration/features/tasks/queueRunner.twoBoardsShareCap.test.ts
git commit -m "test(tasks): integration tests for cap-change-live and two-board shared cap"
```

---

### Task 26: Integration — pause persisted across reload

**Files:**
- Test: `tests/integration/features/tasks/queueRunner.pausePersisted.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { writeBoardQueuePaused, loadBoardConfig } from '../../../../src/features/tasks/config/BoardConfigStore';

describe('QueueRunner integration — pause persisted', () => {
  it('writeBoardQueuePaused round-trips through loadBoardConfig', () => {
    const settings: Record<string, unknown> = {};
    writeBoardQueuePaused(settings, true);
    const { config } = loadBoardConfig(settings);
    expect(config.queue?.paused).toBe(true);

    writeBoardQueuePaused(settings, false);
    const { config: c2 } = loadBoardConfig(settings);
    expect(c2.queue?.paused).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- --selectProjects integration -t "QueueRunner integration — pause persisted"`
Expected: PASS (relies on Task 2 store helpers).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tasks/queueRunner.pausePersisted.test.ts
git commit -m "test(tasks): integration test for pause persistence round-trip"
```

---

### Task 27: Integration — manual run does not count + skip-ledger debounce

**Files:**
- Test: `tests/integration/features/tasks/queueRunner.manualRunDoesNotCountAgainstCap.test.ts`
- Test: `tests/integration/features/tasks/queueRunner.skipLedgerDebounced.test.ts`

- [ ] **Step 1: Write manual-run test**

```typescript
// queueRunner.manualRunDoesNotCountAgainstCap.test.ts
import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id, schema_version: 1, status: 'ready', priority: '2 - normal',
      created: '2026-06-01T00:00:00Z', provider: 'claude',
      model: 'claude-sonnet-4-5', title: id, attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

describe('QueueRunner integration — manual run does not count against cap', () => {
  it('runner ignores a manually-launched task and does not increment halt counter', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    let manualActive = true; // simulate manual run holding the id
    let tasks = [makeTask('a'), makeTask('b')];
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: {
        isProviderEnabled: () => true,
        ownsModel: () => true,
        isActive: (id) => id === 'a' && manualActive,
      },
      coordinator: {
        run: async (task) => {
          runs.push(task.frontmatter.id);
          tasks = tasks.filter((t) => t.frontmatter.id !== task.frontmatter.id);
          return { ok: true, status: 'review' };
        },
        isActive: (id) => id === 'a' && manualActive,
      },
      appendLedger: async () => {},
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual(['b']); // runner picks b, not a (a is manual)

    manualActive = false;
    runner.tick();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    // a remains because runner already picked b; counter is 0
    expect(runner.isHalted()).toBe(false);
  });
});
```

- [ ] **Step 2: Write skip-debounce test**

```typescript
// queueRunner.skipLedgerDebounced.test.ts
import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id, schema_version: 1, status: 'ready', priority: '2 - normal',
      created: '2026-06-01T00:00:00Z', provider: 'codex',
      model: 'gpt-5', title: id, attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

describe('QueueRunner integration — skip ledger debounce', () => {
  it('writes one ledger entry per (task, reason) within 60s', async () => {
    let nowMs = 100_000;
    const ledger: string[] = [];
    const tasks = [makeTask('a')];
    const runner = new QueueRunner({
      slot: new QueueSlotTracker(1),
      getTasks: () => tasks,
      eligibility: { isProviderEnabled: () => false, ownsModel: () => true, isActive: () => false },
      coordinator: { run: async () => ({ ok: true, status: 'review' }), isActive: () => false },
      appendLedger: async (_task, entry) => { ledger.push(entry.message); },
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => nowMs,
    });
    runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger).toHaveLength(1);

    nowMs += 60_001;
    runner.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run both tests**

Run: `npm run test -- --selectProjects integration -t "QueueRunner integration — manual run does not count against cap"`
Run: `npm run test -- --selectProjects integration -t "QueueRunner integration — skip ledger debounce"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/features/tasks/queueRunner.manualRunDoesNotCountAgainstCap.test.ts tests/integration/features/tasks/queueRunner.skipLedgerDebounced.test.ts
git commit -m "test(tasks): integration tests for manual-run bypass and ledger debounce"
```

---

### Task 28: Perf — tick cost stays O(eligible)

**Files:**
- Test: `tests/perf/queueRunner.perf.test.ts`

- [ ] **Step 1: Write the perf scaling guard**

Create `tests/perf/queueRunner.perf.test.ts`:

```typescript
import { QueueRunner } from '../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../src/features/tasks/model/taskTypes';

function makeTask(id: string, status: 'ready' | 'done' = 'ready'): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    sections: { body: '', ledger: [] },
    frontmatter: {
      id, schema_version: 1, status, priority: '2 - normal',
      created: '2026-06-01T00:00:00Z', provider: 'claude',
      model: 'claude-sonnet-4-5', title: id, attempts: 0,
    } as TaskSpec['frontmatter'],
  } as TaskSpec;
}

function ticksTouched(totalTasks: number, eligibleCount: number): number {
  const tasks: TaskSpec[] = [];
  for (let i = 0; i < totalTasks; i++) {
    tasks.push(makeTask(`t${i}`, i < eligibleCount ? 'ready' : 'done'));
  }
  let touched = 0;
  const runner = new QueueRunner({
    slot: new QueueSlotTracker(1),
    getTasks: () => tasks,
    eligibility: {
      isProviderEnabled: () => { touched++; return true; },
      ownsModel: () => true,
      isActive: () => false,
    },
    coordinator: { run: async () => ({ ok: true, status: 'review' }), isActive: () => false },
    appendLedger: async () => {},
    events: { emit: () => {}, on: () => () => {} },
    haltAfterFailures: 3,
    initialPaused: false,
    now: () => Date.now(),
  });
  runner.tick();
  return touched;
}

describe('QueueRunner perf', () => {
  it('tick cost scales with eligible cards, not total', () => {
    const tinyEligible = ticksTouched(1000, 1);
    const moreEligible = ticksTouched(1000, 10);
    expect(moreEligible).toBeLessThanOrEqual(tinyEligible * 12);
  });
});
```

- [ ] **Step 2: Run the perf suite**

Run: `npm run test:perf -- -t "QueueRunner perf"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/perf/queueRunner.perf.test.ts
git commit -m "test(perf): guard QueueRunner tick cost scales with eligible cards"
```

---

### Task 29: Full gate + manual smoke

**Files:**
- None (verification only).

- [ ] **Step 1: Run the full verification gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: ALL GREEN.

- [ ] **Step 2: Reload the plugin in Obsidian**

Following the dev-build setup, ensure the build artifacts are copied into the vault's `.obsidian/plugins/<id>/`. In Obsidian, disable and re-enable the plugin.

- [ ] **Step 3: Manual smoke checklist**

Walk through each item from the spec's manual smoke section. Record observations.

- [ ] **3a.** Open the Agent Board with 3 ready cards (mixed providers). Runner drains them sequentially. Confirm ledger shows `queue:` entries.
- [ ] **3b.** Pause mid-run via toolbar. Active run finishes naturally. Next card stays Ready.
- [ ] **3c.** Resume. Next card auto-runs.
- [ ] **3d.** Force a card to pause (`<claudian_needs_input>` block — requires P0+P1 shipped; otherwise SKIP and note in PR).
- [ ] **3e.** Disable a provider in settings. Card with that provider shows skip chip, stays Ready.
- [ ] **3f.** Raise cap to 2 in settings. Two cards run in parallel.
- [ ] **3g.** Point a card at a bad model name; trigger 3 consecutive failures. Halt banner appears. Click "Resume queue". Banner clears.
- [ ] **3h.** Restart Obsidian after pausing. Confirm the board re-opens with queue paused.

- [ ] **Step 4: Attach the board's ledger to the PR**

Copy the ledger Markdown from the work-order notes used in smoke into the PR description.

- [ ] **Step 5: Commit (if any docs / notes added)**

```bash
git status
# only if there are changes:
git add <files>
git commit -m "chore(tasks): record manual smoke evidence for queue runner"
```

---

## Self-Review

Quick check against the spec, with fixes applied inline.

**Spec coverage walk-through:**

- ✓ Goals: auto-pick (Task 9), toolbar toggle (Tasks 15, 18), configurable cap (Tasks 3, 4, 13, 19), auto-halt (Task 11, 23), skip with chip + ledger (Tasks 8, 12, 17, 24), ledger trail (Task 12), coexistence (no order-dependence on P0+P1).
- ✓ Non-goals respected: no new statuses, no per-provider cap, no reorder, no retry, no scheduling, no dependency graph, no cross-vault.
- ✓ State machine unchanged (Task 1 only adds optional `queue.paused` to `BoardConfig`).
- ✓ All 5 spec events emitted (Task 5 declared; Tasks 9–12 emit them).
- ✓ Slot lifecycle covers run, hold-on-pause, release on terminal (Task 9 launch + onSettle; Task 22 integration).
- ✓ Manual-run bypass — verified by Task 27 integration.
- ✓ Cap change live (Tasks 7, 13, 19, 25).
- ✓ Counter scope per-board, runner-only (Tasks 6, 9, 11, 27).
- ✓ Skip ledger debounce 60s (Tasks 9, 12, 27).
- ✓ Two-board shared cap (Tasks 13, 25).
- ✓ Settings UI two number fields with bounds (Task 4).
- ✓ Toolbar, halt banner, skip chip rendering tested (Tasks 15, 16, 17).
- ✓ DOM patching: this plan uses `refresh()` from `AgentBoardView` for queue events (Task 18 step 3). The spec describes finer-grained patching but treats it as a future optimization. Plan choice: correct-first via refresh, optimization later. Documented in Task 18 step 3.
- ✓ Persistence round-trip (Task 2, Task 26).
- ✓ Crash recovery interplay: counter starts at 0 because runner constructs fresh on view mount; orphan-scan from P0+P1 (if present) runs before. No counter-increment from orphan failures because they happen pre-mount.

**Placeholder scan:**

- Task 13 step 4 refers to "the right wiring spot" — gave a grep command to find it (`grep -n "AgentBoardView\|TaskRunCoordinator\|registerView" src/main.ts`). Acceptable because exact line varies as `main.ts` evolves.
- Task 14 step 3 caveats `providerRegistry.isEnabled` / `ownsModel` naming; says "check against the actual API". This is an implementer step that requires reading `main.ts` and the registry — acceptable for a TDD-style plan.
- Task 18 step 1 cast-via-`as unknown as ...` was a code smell; fixed inline by adding `getConsecutiveFailures()` / `getHaltReason()` to `QueueRunner.ts` instead.
- Task 19 step 1 says "if no such event exists, fall back" — both branches give concrete code; acceptable.

**Type consistency:**

- `QueueRunner` deps interface (`QueueRunnerDeps`) declared in Task 9; used by every later task with the same shape. `getTasks` not `tasks`, `appendLedger` not `writeLedger`, `coordinator.isActive` not `coordinator.active`. Consistent.
- `EligibilityPredicates` (`isProviderEnabled`, `ownsModel`, `isActive`) is the same shape in Tasks 8, 9, 21–27.
- `QueueSlotTracker` methods (`acquire`, `release`, `hasFreeSlot`, `setCap`, `isHeld`, `occupied`, `capacity`) — consistent through plan.
- `BoardConfig.queue.paused` (boolean) — consistent.
- `TaskSpec.frontmatter` field names (`id`, `provider`, `model`, `priority`, `created`, `status`) — consistent with existing types (verified against `selectNextReadyTask.ts`).

No outstanding issues.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-work-order-queue.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
