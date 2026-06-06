---
title: Work-order write race fix (sidecar ledger + heartbeat)
date: 2026-06-06
status: implemented
scope: features/tasks
parent: Quality
---

# Work-Order Write Race Fix Implementation Plan

> **Status:** Implemented across 11 plan commits (`c40da7ee` → `16e13ee3`), 4 polish commits (`39388d35` → `6f32da0a`), and 2 follow-up commits (`84ad24b7` quickActions circular import fix, `2b0d8d26` C3 startup sidecar sweep). Race closed end-to-end: heartbeats + ledger writes hit `.claudian/runs/<runId>/` sidecar only; note touched at status transitions + terminal handoff + single ledger snapshot.
>
> **Post-implementation polish:** fresh-vault recursive mkdir, corrupt-JSONL skip, CRLF tolerance, multiline-message flatten, `RunSidecarHeartbeat` dedup, `DEFAULT_STALE_THRESHOLD_MS` shared, live heartbeat in board UI via `task:heartbeat.at`, sidecar GC on terminal (`cleanupRun`), periodic orphan re-check (60s), startup sidecar sweep at board open.
>
> **Known follow-ups:** end-to-end integration test for cleanup-after-snapshot flow (unit-level coverage exists at each seam); manual smoke test in dev vault. Cross-device sync handled by existing `.gitignore` `/.claudian/` entry.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Claudian from racing the agent's `Edit` tool on the work-order note by moving the run ledger and heartbeat to a per-run sidecar; embed the ledger snapshot into the note only at terminal.

**Architecture:** Add `RunSidecarStore` (under `src/features/tasks/storage/`) that owns `.claudian/runs/<runId>/heartbeat.json` and `.claudian/runs/<runId>/ledger.jsonl`. `RunSession` writes heartbeats and ledger entries to the sidecar; status transitions (start, pause, resume, terminal) still write the work-order frontmatter — these align with turn boundaries where the agent has just paused/ended and is not mid-Edit. At terminal, snapshot the sidecar ledger into the note's `<!-- claudian:run-ledger-* -->` region in a single write. Live UI keeps consuming the existing `task:heartbeat` / `task:ledger-appended` events (no event-shape change). Orphan recovery reads heartbeats from the sidecar so plugin reloads still see live runs.

**Tech Stack:** TypeScript, Obsidian Plugin API (`DataAdapter` for sidecar paths), existing Jest unit/integration harness.

---

## Scope Check

This plan covers only the storage/race fix for `RunSession` writes. It does NOT change:
- The protocol-block (`<claudian_progress>` etc.) rendering — see the companion plan `2026-06-06-work-order-protocol-cards.md`.
- The agent's prompt instruction to edit the work-order checklist — that stays.
- Existing event shapes (`task:heartbeat`, `task:ledger-appended`).

## File Structure

- **Create** `src/features/tasks/storage/RunSidecarStore.ts` — owns sidecar paths, heartbeat read/write, ledger append/read, markdown snapshot rendering. One responsibility: filesystem for run sidecars.
- **Create** `tests/unit/features/tasks/storage/RunSidecarStore.test.ts` — unit tests for the store.
- **Create** `tests/integration/features/tasks/runSessionSidecar.integration.test.ts` — integration test proving `RunSession` does not write the work-order note during heartbeats/progress, only at status transitions and terminal.
- **Modify** `src/features/tasks/execution/RunSession.ts` — replace heartbeat-driven `persistStatus` write with `writeHeartbeat`; replace ledger flush target with `appendLedger`/`snapshotLedgerToNote` at terminal.
- **Modify** `src/features/tasks/execution/TaskRunCoordinator.ts` — extend `TaskRunCoordinatorDeps` with `writeHeartbeat`, `appendLedger`, `finalizeLedgerToNote`. Keep existing `writeStatus`/`writeHandoff` for status transitions and handoff only.
- **Modify** `src/features/tasks/ui/AgentBoardView.ts` — wire `RunSidecarStore` into the coordinator; route ledger to sidecar; on orphan recovery, read heartbeat from sidecar.
- **Modify** `src/features/tasks/storage/TaskNoteStore.ts` — add `writeLedgerSnapshot(content, markdown)` that replaces the run-ledger region with a pre-rendered snapshot (mirrors `writeHandoff`).
- **Modify** `src/main.ts` — instantiate the shared `RunSidecarStore` and hand it to `AgentBoardView` (via plugin field, mirroring `taskActiveRuns` / `chatTabReservations`).
- **Modify** `tests/unit/features/tasks/execution/RunSession.test.ts` — update to assert no work-order writes happen on heartbeat/progress.
- **Modify** `tests/unit/features/tasks/storage/TaskNoteStore.test.ts` — add coverage for `writeLedgerSnapshot`.

---

## Task 1: `RunSidecarStore` skeleton + heartbeat round-trip (TDD)

**Files:**
- Create: `src/features/tasks/storage/RunSidecarStore.ts`
- Test: `tests/unit/features/tasks/storage/RunSidecarStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/tasks/storage/RunSidecarStore.test.ts
import type { DataAdapter } from 'obsidian';

import { RunSidecarStore } from '../../../../../src/features/tasks/storage/RunSidecarStore';

function makeFakeAdapter() {
  const files = new Map<string, string>();
  const adapter: Pick<DataAdapter, 'exists' | 'mkdir' | 'read' | 'write' | 'append'> = {
    async exists(path) { return files.has(path); },
    async mkdir(_path) { /* in-memory: no-op */ },
    async read(path) {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    },
    async write(path, data) { files.set(path, data); },
    async append(path, data) { files.set(path, (files.get(path) ?? '') + data); },
  };
  return { adapter: adapter as DataAdapter, files };
}

describe('RunSidecarStore.heartbeat', () => {
  it('round-trips a heartbeat record under .claudian/runs/<runId>/heartbeat.json', async () => {
    const { adapter, files } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await store.writeHeartbeat('run-abc', { at: '2026-06-06T12:00:00.000Z', status: 'running' });

    expect(files.get('.claudian/runs/run-abc/heartbeat.json')).toContain('"status": "running"');
    expect(await store.readHeartbeat('run-abc')).toEqual({
      at: '2026-06-06T12:00:00.000Z',
      status: 'running',
    });
  });

  it('returns null when no heartbeat exists', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    expect(await store.readHeartbeat('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/storage/RunSidecarStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/tasks/storage/RunSidecarStore.ts
import type { DataAdapter } from 'obsidian';

import type { TaskLedgerEntry, TaskStatus } from '../model/taskTypes';

export interface RunSidecarHeartbeat {
  at: string;
  status: TaskStatus;
  pauseReason?: string | null;
}

export class RunSidecarStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly baseDir: string,
  ) {}

  private runDir(runId: string): string { return `${this.baseDir}/${runId}`; }
  private heartbeatPath(runId: string): string { return `${this.runDir(runId)}/heartbeat.json`; }
  private ledgerPath(runId: string): string { return `${this.runDir(runId)}/ledger.jsonl`; }

  async writeHeartbeat(runId: string, heartbeat: RunSidecarHeartbeat): Promise<void> {
    await this.ensureRunDir(runId);
    await this.adapter.write(this.heartbeatPath(runId), JSON.stringify(heartbeat, null, 2));
  }

  async readHeartbeat(runId: string): Promise<RunSidecarHeartbeat | null> {
    if (!(await this.adapter.exists(this.heartbeatPath(runId)))) return null;
    const raw = await this.adapter.read(this.heartbeatPath(runId));
    return JSON.parse(raw) as RunSidecarHeartbeat;
  }

  async appendLedger(_runId: string, _entry: TaskLedgerEntry): Promise<void> {
    throw new Error('not implemented');
  }

  async readLedger(_runId: string): Promise<TaskLedgerEntry[]> {
    throw new Error('not implemented');
  }

  async snapshotLedgerAsMarkdown(_runId: string): Promise<string> {
    throw new Error('not implemented');
  }

  private async ensureRunDir(runId: string): Promise<void> {
    if (!(await this.adapter.exists(this.runDir(runId)))) {
      await this.adapter.mkdir(this.runDir(runId));
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/tasks/storage/RunSidecarStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/storage/RunSidecarStore.ts tests/unit/features/tasks/storage/RunSidecarStore.test.ts
git commit -m "feat(tasks): scaffold RunSidecarStore with heartbeat round-trip"
```

---

## Task 2: `RunSidecarStore` ledger append + read (TDD)

**Files:**
- Modify: `src/features/tasks/storage/RunSidecarStore.ts`
- Test: `tests/unit/features/tasks/storage/RunSidecarStore.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
// append to tests/unit/features/tasks/storage/RunSidecarStore.test.ts
describe('RunSidecarStore.ledger', () => {
  it('appends JSONL entries to .claudian/runs/<runId>/ledger.jsonl', async () => {
    const { adapter, files } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await store.appendLedger('run-1', {
      timestamp: '2026-06-06T12:00:00.000Z',
      status: 'running',
      message: 'Run started (attempt 1)',
    });
    await store.appendLedger('run-1', {
      timestamp: '2026-06-06T12:00:05.000Z',
      status: 'running',
      message: 'progress: scanning files',
    });

    const raw = files.get('.claudian/runs/run-1/ledger.jsonl') as string;
    expect(raw.split('\n').filter((l) => l.length > 0)).toHaveLength(2);
    const entries = await store.readLedger('run-1');
    expect(entries.map((e) => e.message)).toEqual([
      'Run started (attempt 1)',
      'progress: scanning files',
    ]);
  });

  it('returns [] for a missing ledger file', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    expect(await store.readLedger('nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/features/tasks/storage/RunSidecarStore.test.ts`
Expected: FAIL — "not implemented" thrown.

- [ ] **Step 3: Implement append + read**

```ts
// replace stubs in src/features/tasks/storage/RunSidecarStore.ts
async appendLedger(runId: string, entry: TaskLedgerEntry): Promise<void> {
  await this.ensureRunDir(runId);
  const line = `${JSON.stringify(entry)}\n`;
  await this.adapter.append(this.ledgerPath(runId), line);
}

async readLedger(runId: string): Promise<TaskLedgerEntry[]> {
  if (!(await this.adapter.exists(this.ledgerPath(runId)))) return [];
  const raw = await this.adapter.read(this.ledgerPath(runId));
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TaskLedgerEntry);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/features/tasks/storage/RunSidecarStore.test.ts`
Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/storage/RunSidecarStore.ts tests/unit/features/tasks/storage/RunSidecarStore.test.ts
git commit -m "feat(tasks): RunSidecarStore appends + reads JSONL ledger"
```

---

## Task 3: `RunSidecarStore.snapshotLedgerAsMarkdown` (TDD)

**Files:**
- Modify: `src/features/tasks/storage/RunSidecarStore.ts`
- Test: `tests/unit/features/tasks/storage/RunSidecarStore.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
// append to tests/unit/features/tasks/storage/RunSidecarStore.test.ts
describe('RunSidecarStore.snapshotLedgerAsMarkdown', () => {
  it('renders ledger entries as one markdown line each, matching TaskNoteStore.appendLedger format', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await store.appendLedger('run-7', {
      timestamp: '2026-06-06T12:00:00.000Z',
      status: 'running',
      message: 'Run started (attempt 1)',
    });
    await store.appendLedger('run-7', {
      timestamp: '2026-06-06T12:00:05.000Z',
      status: 'review',
      message: 'Handoff written.',
    });

    const md = await store.snapshotLedgerAsMarkdown('run-7');
    expect(md).toBe(
      '- 2026-06-06T12:00:00.000Z [running] Run started (attempt 1)\n' +
      '- 2026-06-06T12:00:05.000Z [review] Handoff written.',
    );
  });

  it('returns empty string for a missing ledger', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    expect(await store.snapshotLedgerAsMarkdown('nope')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/storage/RunSidecarStore.test.ts`
Expected: FAIL — "not implemented".

- [ ] **Step 3: Implement snapshot**

```ts
// replace stub in src/features/tasks/storage/RunSidecarStore.ts
async snapshotLedgerAsMarkdown(runId: string): Promise<string> {
  const entries = await this.readLedger(runId);
  return entries
    .map((e) => `- ${e.timestamp} [${e.status}] ${e.message}`)
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/tasks/storage/RunSidecarStore.test.ts`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/storage/RunSidecarStore.ts tests/unit/features/tasks/storage/RunSidecarStore.test.ts
git commit -m "feat(tasks): RunSidecarStore renders markdown ledger snapshot"
```

---

## Task 4: `TaskNoteStore.writeLedgerSnapshot` (TDD)

**Files:**
- Modify: `src/features/tasks/storage/TaskNoteStore.ts`
- Test: `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
// append to tests/unit/features/tasks/storage/TaskNoteStore.test.ts
import { RUN_LEDGER_END, RUN_LEDGER_START } from '../../../../../src/features/tasks/storage/TaskNoteStore';

describe('TaskNoteStore.writeLedgerSnapshot', () => {
  const store = new TaskNoteStore();
  const baseNote =
    '---\n' +
    'type: claudian-work-order\nschema_version: 1\nid: t\ntitle: t\nstatus: running\nupdated: x\n' +
    '---\n' +
    '## Objective\nx\n## Acceptance Criteria\n- [ ] a\n## Context\nx\n## Constraints\nx\n' +
    `${RUN_LEDGER_START}\n- old line\n${RUN_LEDGER_END}\n` +
    '<!-- claudian:handoff-start -->\n<!-- claudian:handoff-end -->\n';

  it('replaces the run-ledger region with the provided snapshot in one write', () => {
    const next = store.writeLedgerSnapshot(baseNote, '- 2026-06-06T... [running] new line');
    expect(next).toContain(`${RUN_LEDGER_START}\n- 2026-06-06T... [running] new line\n${RUN_LEDGER_END}`);
    expect(next).not.toContain('- old line');
  });

  it('rejects snapshots that embed claudian markers', () => {
    expect(() => store.writeLedgerSnapshot(baseNote, '<!-- claudian:run-ledger-start -->'))
      .toThrow(/Generated task region content cannot contain Claudian markers/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/storage/TaskNoteStore.test.ts`
Expected: FAIL — `writeLedgerSnapshot` not a function.

- [ ] **Step 3: Add the method**

In `src/features/tasks/storage/TaskNoteStore.ts`, beneath `appendLedger`, add:

```ts
writeLedgerSnapshot(content: string, markdown: string): string {
  this.assertNoEmbeddedClaudianMarkers(markdown);
  return this.replaceGeneratedRegion(content, RUN_LEDGER_START, RUN_LEDGER_END, markdown.trim());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/tasks/storage/TaskNoteStore.test.ts`
Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/storage/TaskNoteStore.ts tests/unit/features/tasks/storage/TaskNoteStore.test.ts
git commit -m "feat(tasks): TaskNoteStore.writeLedgerSnapshot replaces ledger region atomically"
```

---

## Task 5: Extend `RunSessionDeps` with sidecar hooks; route heartbeat + ledger off the note (TDD)

**Files:**
- Modify: `src/features/tasks/execution/RunSession.ts`
- Test: `tests/unit/features/tasks/execution/RunSession.test.ts`

This task is the load-bearing one. Read `tests/unit/features/tasks/execution/RunSession.test.ts` in full first — it likely already asserts `writeStatus` calls on heartbeat, and those assertions must change to `writeHeartbeat`.

- [ ] **Step 1: Add new failing tests**

```ts
// in tests/unit/features/tasks/execution/RunSession.test.ts (a new describe)
describe('RunSession sidecar writes', () => {
  it('does not call writeStatus during heartbeat ticks; calls writeHeartbeat instead', async () => {
    jest.useFakeTimers();
    const writeStatus = jest.fn().mockResolvedValue(undefined);
    const writeHeartbeat = jest.fn().mockResolvedValue(undefined);
    const appendLedger = jest.fn().mockResolvedValue(undefined);
    const finalizeLedgerToNote = jest.fn().mockResolvedValue(undefined);
    const writeHandoff = jest.fn().mockResolvedValue(undefined);

    const session = new RunSession({
      // ... existing test scaffolding (task/runId/stream/events/now stubs)
      writeStatus,
      writeHeartbeat,
      appendLedger,
      finalizeLedgerToNote,
      writeHandoff,
      flushLedger: jest.fn(), // legacy field unused; will be removed in a later task
      heartbeatIntervalMs: 100,
      staleThresholdMs: 100_000,
    } as any);

    void session.run();
    // Drain the run-start status write.
    await Promise.resolve();
    writeStatus.mockClear();

    // Advance two heartbeat intervals.
    jest.advanceTimersByTime(250);
    await Promise.resolve();

    expect(writeStatus).not.toHaveBeenCalled();
    expect(writeHeartbeat).toHaveBeenCalled();
    const firstCall = writeHeartbeat.mock.calls[0][0]; // (runId, heartbeat)
    expect(firstCall).toBe('run-id'); // align with the scaffold's runId
  });

  it('routes ledger entries through appendLedger, not flushLedger', async () => {
    const appendLedger = jest.fn().mockResolvedValue(undefined);
    // ... build a session emitting a single progress block via the stream
    // (mirror the existing progress test) and assert appendLedger received it.
  });

  it('on terminal, writes one finalizeLedgerToNote call after the handoff write', async () => {
    // ... emit a valid <claudian_handoff> via the stream, then assert
    // finalizeLedgerToNote was called exactly once and AFTER writeHandoff.
  });
});
```

(Build the test scaffolding from the existing `RunSession.test.ts` fixtures — do not invent new shapes.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/features/tasks/execution/RunSession.test.ts`
Expected: FAIL — `writeHeartbeat`/`appendLedger`/`finalizeLedgerToNote` not declared on `RunSessionDeps`.

- [ ] **Step 3: Extend the deps + implement the routing**

In `src/features/tasks/execution/RunSession.ts`:

```ts
// Extend RunSessionDeps
export interface RunSessionDeps {
  // ... existing fields stay
  writeHeartbeat: (runId: string, heartbeat: { at: string; status: TaskStatus; pauseReason?: string | null }) => Promise<void>;
  appendLedger: (runId: string, entry: TaskLedgerEntry) => Promise<void>;
  finalizeLedgerToNote: (task: TaskSpec, runId: string) => Promise<void>;
}
```

- Replace the heartbeat body in `startHeartbeat()` so the interval calls `this.deps.writeHeartbeat(this.deps.runId, { at, status: 'running' })` (still wrapped in `trackBackgroundWrite`), removing the `persistStatus({ status: 'running', heartbeat: at })` call.
- Replace the `LedgerWriter` `flush` callback so it calls `this.deps.appendLedger(this.deps.runId, entry)` per entry (and still emits `task:ledger-appended`). Keep the same batching to avoid syscall-per-progress.
- In `finalizeRun`, immediately after the terminal `persistStatus` (any path: completed/failed/canceled/needs_handoff/review) and after the handoff write, `await this.deps.finalizeLedgerToNote(this.deps.task, this.deps.runId)`. Do this BEFORE `settle(...)` so the ledger snapshot is on disk when callers consume the terminal result.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/features/tasks/execution/RunSession.test.ts`
Expected: PASS — new cases green, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/RunSession.ts tests/unit/features/tasks/execution/RunSession.test.ts
git commit -m "feat(tasks): RunSession routes heartbeat + ledger to sidecar; snapshots to note at terminal"
```

---

## Task 6: `TaskRunCoordinator` forwards the new deps

**Files:**
- Modify: `src/features/tasks/execution/TaskRunCoordinator.ts`
- Test: `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`

- [ ] **Step 1: Add a failing assertion**

In the existing coordinator test (or a new `describe`), assert that the `RunSession` it constructs receives `writeHeartbeat`, `appendLedger`, and `finalizeLedgerToNote`:

```ts
it('forwards sidecar hooks to RunSession', async () => {
  const writeHeartbeat = jest.fn();
  const appendLedger = jest.fn();
  const finalizeLedgerToNote = jest.fn();
  const coordinator = new TaskRunCoordinator({
    // ... existing fixture deps
    writeHeartbeat,
    appendLedger,
    finalizeLedgerToNote,
  } as any);
  // Spy on RunSession construction by injecting a renderPrompt that records,
  // or by exercising run() and asserting the deps were called from the stubbed
  // stream — mirror the existing TaskRunCoordinator.test.ts patterns.
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`
Expected: FAIL — new fields not on `TaskRunCoordinatorDeps`.

- [ ] **Step 3: Wire the deps**

In `src/features/tasks/execution/TaskRunCoordinator.ts`:

```ts
export interface TaskRunCoordinatorDeps {
  // ... existing fields stay
  writeHeartbeat: (runId: string, hb: { at: string; status: TaskStatus; pauseReason?: string | null }) => Promise<void>;
  appendLedger: (task: TaskSpec, runId: string, entry: TaskLedgerEntry) => Promise<void>;
  finalizeLedgerToNote: (task: TaskSpec, runId: string) => Promise<void>;
}
```

In `run()`, when constructing `new RunSession({...})`, pass:

```ts
writeHeartbeat: (runId, hb) => this.deps.writeHeartbeat(runId, hb),
appendLedger: (runId, entry) => this.deps.appendLedger(task, runId, entry),
finalizeLedgerToNote: (t, runId) => this.deps.finalizeLedgerToNote(t, runId),
```

Drop the now-unused `flushLedger` field from the `RunSession` construction call (it stays on the legacy `TaskRunCoordinatorDeps` for one more task so AgentBoardView still compiles; we'll delete it in Task 8).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/TaskRunCoordinator.ts tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
git commit -m "feat(tasks): TaskRunCoordinator wires sidecar hooks into RunSession"
```

---

## Task 7: Instantiate `RunSidecarStore` in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add a field + init**

In the plugin's `onload` (or wherever `taskActiveRuns` / `chatTabReservations` are set up), add:

```ts
import { RunSidecarStore } from './features/tasks/storage/RunSidecarStore';

// inside the plugin class:
runSidecarStore!: RunSidecarStore;

// inside onload, before any AgentBoardView opens:
this.runSidecarStore = new RunSidecarStore(this.app.vault.adapter, '.claudian/runs');
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(tasks): wire shared RunSidecarStore on plugin load"
```

---

## Task 8: `AgentBoardView` wires sidecar; drops note-bound `flushLedger`

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`
- Modify: `src/features/tasks/execution/TaskRunCoordinator.ts` (remove legacy `flushLedger` field)
- Test: `tests/unit/features/tasks/ui/AgentBoardView.test.ts` (if it asserts coordinator deps)

- [ ] **Step 1: Update coordinator construction in `AgentBoardView`**

Replace the existing block in `createCoordinator()` (around lines 82–95) so it reads:

```ts
writeTaskStatus: async (task, options) => {
  await this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, options));
  this.lastRunStatus.set(task.frontmatter.id, options.status);
},
writeHeartbeat: (runId, hb) =>
  this.plugin.runSidecarStore.writeHeartbeat(runId, hb),
appendLedger: (_task, runId, entry) =>
  this.plugin.runSidecarStore.appendLedger(runId, entry),
finalizeLedgerToNote: async (task, runId) => {
  const snapshot = await this.plugin.runSidecarStore.snapshotLedgerAsMarkdown(runId);
  if (!snapshot) return;
  await this.applyNoteChange(task.path, (content) => this.noteStore.writeLedgerSnapshot(content, snapshot));
},
writeHandoff: (task, markdown) =>
  this.applyNoteChange(task.path, (content) => this.noteStore.writeHandoff(content, markdown)),
```

Delete the old `flushLedger:` block.

- [ ] **Step 2: Drop `flushLedger` from `TaskRunCoordinatorDeps`**

Remove `flushLedger?: ...` (and the matching pass-through to `RunSession`, and the legacy field in `RunSessionDeps`). Update any other call sites the compiler flags.

- [ ] **Step 3: Typecheck + run unit tests**

Run: `npm run typecheck && npm run test -- tests/unit/features/tasks`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts src/features/tasks/execution/TaskRunCoordinator.ts src/features/tasks/execution/RunSession.ts
git commit -m "feat(tasks): route AgentBoardView through RunSidecarStore; drop note-bound flushLedger"
```

---

## Task 9: Orphan recovery reads heartbeat from sidecar

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts` (find `recoverOrphanedRuns`)
- Test: extend `tests/unit/features/tasks/ui/AgentBoardView.test.ts`

- [ ] **Step 1: Read the current `recoverOrphanedRuns` implementation**

Read `src/features/tasks/ui/AgentBoardView.ts` from line 525 to the end of `recoverOrphanedRuns` to understand its current liveness check (it currently reads `frontmatter.heartbeat`).

- [ ] **Step 2: Add the failing test**

```ts
// in AgentBoardView.test.ts
it('treats a fresh sidecar heartbeat as live and skips orphan adoption', async () => {
  // fixture: a work order with status: running, frontmatter.heartbeat = stale (10m ago),
  // but RunSidecarStore.readHeartbeat returns { at: now-2s, status: 'running' }.
  // expect: the view does NOT mark it failed via the "orphaned by plugin reload" ledger line.
});

it('marks the run failed when neither frontmatter nor sidecar heartbeat is recent', async () => {
  // ... assert the "orphaned by plugin reload" ledger line lands AND status -> failed.
});
```

- [ ] **Step 3: Update `recoverOrphanedRuns`**

Change the liveness comparison: take `Math.max(frontmatterHeartbeatMs, sidecarHeartbeatMs)` (treat missing values as 0) and compare against `now - stale_threshold`. Source: `await this.plugin.runSidecarStore.readHeartbeat(frontmatter.run_id)`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- tests/unit/features/tasks/ui/AgentBoardView.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts tests/unit/features/tasks/ui/AgentBoardView.test.ts
git commit -m "fix(tasks): orphan recovery prefers sidecar heartbeat over stale frontmatter"
```

---

## Task 10: Integration test — `RunSession` never writes the note during heartbeat/progress

**Files:**
- Create: `tests/integration/features/tasks/runSessionSidecar.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/features/tasks/runSessionSidecar.integration.test.ts
import { RunSession } from '../../../../src/features/tasks/execution/RunSession';

describe('RunSession sidecar — work-order note is untouched between status transitions', () => {
  it('does not call writeStatus or writeHandoff for heartbeats or progress blocks', async () => {
    jest.useFakeTimers();

    const writeStatus = jest.fn().mockResolvedValue(undefined);
    const writeHandoff = jest.fn().mockResolvedValue(undefined);
    const writeHeartbeat = jest.fn().mockResolvedValue(undefined);
    const appendLedger = jest.fn().mockResolvedValue(undefined);
    const finalizeLedgerToNote = jest.fn().mockResolvedValue(undefined);

    // Build a fake stream that lets us emit text + onEnd.
    let listener!: { onText: (s: string) => void; onEnd: (p: any) => void };
    const stream = {
      subscribe: (l: any) => { listener = l; return () => {}; },
      cancel: jest.fn(),
      sendFollowUp: jest.fn(),
    };

    const session = new RunSession({
      task: { path: 'wo.md', frontmatter: { id: 't', title: 't', attempts: 0 }, sections: {} } as any,
      runId: 'r',
      getConversationId: () => null,
      sidepanelTabId: null,
      stream: stream as any,
      events: { emit: jest.fn() } as any,
      now: () => '2026-06-06T12:00:00.000Z',
      writeStatus,
      writeHeartbeat,
      appendLedger,
      finalizeLedgerToNote,
      writeHandoff,
      heartbeatIntervalMs: 50,
      ledgerIntervalMs: 50,
      ledgerMilestone: 1,
    });

    void session.run();
    await Promise.resolve(); // drain the start status write
    writeStatus.mockClear();

    // Heartbeat tick + a progress block + several more heartbeats.
    jest.advanceTimersByTime(60);
    await Promise.resolve();
    listener.onText('<claudian_progress>\nstep: scanning\ndone: 1/3\n</claudian_progress>');
    jest.advanceTimersByTime(120);
    await Promise.resolve();

    expect(writeStatus).not.toHaveBeenCalled();
    expect(writeHandoff).not.toHaveBeenCalled();
    expect(writeHeartbeat.mock.calls.length).toBeGreaterThan(0);
    expect(appendLedger.mock.calls.length).toBeGreaterThan(0);

    // Terminal handoff DOES write the note exactly once for handoff + once for finalize.
    listener.onText('<claudian_handoff>\nsummary: s\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>');
    listener.onEnd({ status: 'completed', finalAssistantContent: '<claudian_handoff>\nsummary: s\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>' });
    await jest.runAllTimersAsync();

    expect(writeHandoff).toHaveBeenCalledTimes(1);
    expect(finalizeLedgerToNote).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails (before Tasks 5-8) or passes (after)**

Run: `npm run test -- --selectProjects integration tests/integration/features/tasks/runSessionSidecar.integration.test.ts`
Expected after Tasks 5–8: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tasks/runSessionSidecar.integration.test.ts
git commit -m "test(tasks): integration test pinning the no-race-on-note invariant"
```

---

## Task 11: Final verification + sweep

- [ ] **Step 1: Full typecheck + lint + tests + build**

Run sequentially:
```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

All four MUST be clean. Fix anything that drifted (commonly: lingering references to `flushLedger`, missing imports in `main.ts`, lint hits on new files).

- [ ] **Step 2: Smoke-test in the dev vault**

- Open Agent Board, launch a work order whose first task tells the agent to immediately `Edit` the work-order note (toggle a checkbox).
- Verify NO `<tool_use_error>File has been modified since read…</tool_use_error>` appears.
- Verify the work-order note's ledger region is empty during the run and gets populated at terminal.
- Verify the live strip on the board still ticks (heartbeat events still flow).
- Stop+reload the plugin mid-run; verify orphan recovery does NOT mark it failed (sidecar heartbeat is fresh).

- [ ] **Step 3: Commit any fixups + push**

```bash
git status
git add -p   # only the fixup hunks
git commit -m "fix(tasks): post-verification fixups"
```

---

## Self-Review Pass

1. **Spec coverage:** Race fix → Tasks 1–8 build the sidecar + reroute writes. Orphan recovery → Task 9. Pin invariant → Task 10. Verify everything → Task 11. ✓
2. **Placeholder scan:** Task 5/6 reference "existing test scaffolding" — that's acceptable when extending an existing test file; the new assertions are spelled out. Other tasks contain full code. ✓
3. **Type consistency:** `writeHeartbeat(runId, { at, status })`, `appendLedger(runId, entry)`, `finalizeLedgerToNote(task, runId)` used consistently across Tasks 5, 6, 8. `TaskRunCoordinatorDeps.appendLedger` takes `(task, runId, entry)` because the coordinator forwards both the task identity (for path resolution in alternate adapters) and the runId; `RunSession`-side `appendLedger` only needs `(runId, entry)` since the session already holds the task. ✓
