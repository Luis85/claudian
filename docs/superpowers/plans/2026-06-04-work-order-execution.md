---
title: Work-order execution — visibility + protocols (P0+P1) Implementation Plan
date: 2026-06-04
status: open
parent: "[[2026-06-04-work-order-execution-design]]"
---

# Work-order Execution — Visibility + Protocols Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make work-order runs observable on the Agent Board card without opening the tab, and activate `needs_input` / `needs_approval` states via agent-emitted inline protocol blocks. Ship across all four providers (Claude, Codex, Opencode, Cursor).

**Architecture:** Coordinator-as-bus. `TaskRunCoordinator` constructs a per-run `RunSession` that owns lifecycle, heartbeat, debounced ledger writes, and pause/resume. A small `ProviderStreamAdapter` interface lets each provider feed live events. A new `ClaudianBlockParser` extracts `<claudian_progress>`, `<claudian_needs_input>`, `<claudian_needs_approval>` from the assistant stream. The Agent Board card patches in place (no full re-render) and shows a live strip with last ledger line, elapsed timer, attempt pill, heartbeat-stale dot, and inline reply box for paused states.

**Tech Stack:** TypeScript, Jest, existing Claudian event bus (`src/core/events/EventBus.ts`), Obsidian Plugin API (`vault.process` for atomic note writes), provider runtimes already in `src/providers/{claude,codex,opencode,cursor}/`.

---

## Scope Check

Implements the approved design in [[2026-06-04-work-order-execution-design]]. Out of scope per the spec: tab queue, dependencies, DoR/DoD validators, incremental indexing, subagent attribution, provider-native background, reload-resume for paused runs, cost UI.

If execution proves too long, the per-provider adapter tasks (Tasks 11–14) can each be split out as separate PRs — they share only the `ProviderStreamAdapter` interface from Task 5.

## File Structure

- Modify `src/features/tasks/model/taskTypes.ts`: add `needs_handoff` to `TaskStatus`; add `heartbeat` and `pause_reason` to `TaskFrontmatter`.
- Modify `src/features/tasks/model/taskStateMachine.ts`: add `needs_handoff` and its transitions.
- Modify `src/features/tasks/storage/TaskNoteStore.ts`: `writeStatus` writes new frontmatter fields; new `clearPause` helper.
- Create `src/features/tasks/execution/ClaudianBlockParser.ts`: streaming parser for the three new blocks.
- Create `src/features/tasks/execution/LedgerWriter.ts`: debounced batched writer with in-memory tail.
- Create `src/features/tasks/execution/ProviderStreamAdapter.ts`: interface contract.
- Modify `src/features/tasks/events.ts`: add new event keys to `TaskEventMap`.
- Create `src/features/tasks/execution/RunSession.ts`: per-run object.
- Modify `src/features/tasks/execution/TaskExecutionSurface.ts`: new `TaskRunHandle` shape with `stream` + `terminal`; add `sendFollowUp` requirement to the surface.
- Modify `src/features/tasks/execution/ChatTabExecutionSurface.ts`: implement new contract.
- Modify `src/features/chat/ClaudianView.ts`: `startTaskRunInFreshTab` returns the new handle shape.
- Modify `src/features/tasks/execution/TaskRunCoordinator.ts`: delegate to `RunSession`.
- Modify `src/features/tasks/prompt/TaskPromptRenderer.ts`: add `## Protocol` and `## Prior Attempts`.
- Create `src/providers/claude/runtime/ClaudeStreamAdapter.ts`.
- Create `src/providers/codex/runtime/CodexStreamAdapter.ts`.
- Create `src/providers/opencode/runtime/OpencodeStreamAdapter.ts`.
- Create `src/providers/cursor/runtime/CursorStreamAdapter.ts`.
- Modify `src/features/tasks/ui/AgentBoardRenderer.ts`: per-card DOM diffing; live strip; paused reply surface.
- Modify `src/features/tasks/ui/AgentBoardView.ts`: subscribe to new events; route reply/approve/reject; crash-recovery scan.
- Modify `src/style/tasks/_agent-board.css` (or equivalent): live strip, stale dot, reply box styles.
- Mirrored test files under `tests/unit/` and `tests/integration/`.
- Create `tests/helpers/SyntheticStreamAdapter.ts`: synthetic adapter for tests.

---

### Task 1: Extend status + frontmatter types

**Files:**
- Modify: `src/features/tasks/model/taskTypes.ts`
- Modify: `src/features/tasks/model/taskStateMachine.ts`
- Test: `tests/unit/features/tasks/model/taskStateMachine.test.ts`

- [ ] **Step 1: Add failing transition cases for the new state**

Open `tests/unit/features/tasks/model/taskStateMachine.test.ts`. Replace the `TASK_STATUSES` assertion and the two `it.each` blocks to add the new state and transitions:

```typescript
it('lists the MVP statuses in lane order', () => {
  expect(TASK_STATUSES).toEqual([
    'inbox',
    'ready',
    'running',
    'needs_input',
    'needs_approval',
    'review',
    'needs_fix',
    'needs_handoff',
    'done',
    'failed',
    'canceled',
  ]);
});
```

Append to the "allows" `it.each` array:

```typescript
['running', 'needs_input'],
['running', 'needs_approval'],
['running', 'needs_handoff'],
['needs_input', 'running'],
['needs_input', 'failed'],
['needs_input', 'canceled'],
['needs_approval', 'running'],
['needs_approval', 'failed'],
['needs_approval', 'canceled'],
['needs_handoff', 'review'],
['needs_handoff', 'failed'],
```

Append to the "rejects" `it.each` array:

```typescript
['ready', 'needs_handoff'],
['done', 'needs_handoff'],
['needs_handoff', 'running'],
['needs_handoff', 'inbox'],
```

- [ ] **Step 2: Run the failing test**

```bash
npm test -- --selectProjects unit --testPathPatterns=taskStateMachine
```

Expected: FAIL — `needs_handoff` not in `TASK_STATUSES`; transitions missing.

- [ ] **Step 3: Add the new status to the type**

Edit `src/features/tasks/model/taskTypes.ts`. Replace the `TaskStatus` union:

```typescript
export type TaskStatus =
  | 'inbox'
  | 'ready'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'review'
  | 'needs_fix'
  | 'needs_handoff'
  | 'done'
  | 'failed'
  | 'canceled';
```

In the same file, extend `TaskFrontmatter` with two new optional fields (place after `finished`):

```typescript
export interface TaskFrontmatter {
  type: 'claudian-work-order';
  schema_version: 1;
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  created: string;
  updated: string;
  provider?: ProviderId;
  model?: string;
  run_id?: string | null;
  conversation_id?: string | null;
  sidepanel_tab_id?: string | null;
  started?: string | null;
  finished?: string | null;
  heartbeat?: string | null;
  pause_reason?: string | null;
  attempts: number;
}
```

- [ ] **Step 4: Add transitions and new status to the state machine**

Edit `src/features/tasks/model/taskStateMachine.ts`. Replace the `TASK_STATUSES` and `LEGAL_TRANSITIONS` definitions:

```typescript
export const TASK_STATUSES = Object.freeze([
  'inbox',
  'ready',
  'running',
  'needs_input',
  'needs_approval',
  'review',
  'needs_fix',
  'needs_handoff',
  'done',
  'failed',
  'canceled',
] as const satisfies readonly TaskStatus[]);

const LEGAL_TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map([
  ['inbox', new Set(['ready'])],
  ['ready', new Set(['running'])],
  ['running', new Set(['review', 'failed', 'canceled', 'needs_input', 'needs_approval', 'needs_handoff'])],
  ['needs_input', new Set(['running', 'failed', 'canceled'])],
  ['needs_approval', new Set(['running', 'failed', 'canceled'])],
  ['review', new Set(['done', 'needs_fix', 'canceled'])],
  ['needs_fix', new Set(['ready', 'running', 'canceled'])],
  ['needs_handoff', new Set(['review', 'failed'])],
  ['done', new Set(['inbox'])],
  ['failed', new Set(['ready'])],
  ['canceled', new Set()],
]);
```

- [ ] **Step 5: Run tests, typecheck, lint**

```bash
npm test -- --selectProjects unit --testPathPatterns=taskStateMachine
npm run typecheck
npm run lint
```

Expected: all green. `typecheck` exits 0; `lint` exits 0; tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/model/taskTypes.ts src/features/tasks/model/taskStateMachine.ts tests/unit/features/tasks/model/taskStateMachine.test.ts
git commit -m "feat(tasks): add needs_handoff status and heartbeat/pause_reason frontmatter"
```

---

### Task 2: TaskNoteStore writes new frontmatter fields

**Files:**
- Modify: `src/features/tasks/storage/TaskNoteStore.ts`
- Test: `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`

- [ ] **Step 1: Add failing test for heartbeat/pause_reason writes**

Open `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`. Add at the bottom of the existing `describe('TaskNoteStore')`:

```typescript
describe('writeStatus heartbeat + pause_reason', () => {
  const baseNote = `---
type: claudian-work-order
schema_version: 1
id: t1
title: T1
status: running
priority: 2 - normal
created: 2026-06-04T08:00:00.000Z
updated: 2026-06-04T08:00:00.000Z
attempts: 0
---
body`;

  it('writes heartbeat and pause_reason when provided', () => {
    const store = new TaskNoteStore();
    const result = store.writeStatus(baseNote, {
      status: 'needs_input',
      timestamp: '2026-06-04T09:00:00.000Z',
      heartbeat: '2026-06-04T09:00:00.000Z',
      pauseReason: 'Which env file?',
    });
    expect(result).toContain('heartbeat: 2026-06-04T09:00:00.000Z');
    expect(result).toContain('pause_reason: "Which env file?"');
  });

  it('clears pause_reason on clearPause', () => {
    const store = new TaskNoteStore();
    const paused = store.writeStatus(baseNote, {
      status: 'needs_input',
      timestamp: '2026-06-04T09:00:00.000Z',
      pauseReason: 'Which env file?',
    });
    const cleared = store.clearPause(paused, '2026-06-04T09:01:00.000Z');
    expect(cleared).toContain('pause_reason: null');
    expect(cleared).toContain('heartbeat: 2026-06-04T09:01:00.000Z');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npm test -- --selectProjects unit --testPathPatterns=TaskNoteStore
```

Expected: FAIL — `WriteStatusOptions` does not accept `heartbeat`/`pauseReason`; `clearPause` does not exist.

- [ ] **Step 3: Extend `WriteStatusOptions` and the write path**

Edit `src/features/tasks/storage/TaskNoteStore.ts`. Replace the `WriteStatusOptions` interface and the `writeStatus` method:

```typescript
export interface WriteStatusOptions {
  status: TaskStatus;
  timestamp: string;
  runId?: string | null;
  conversationId?: string | null;
  sidepanelTabId?: string | null;
  heartbeat?: string | null;
  pauseReason?: string | null;
}
```

Replace `writeStatus`:

```typescript
writeStatus(content: string, options: WriteStatusOptions): string {
  const parsed = this.parse('', content);
  const frontmatter: Record<string, unknown> = { ...parsed.task.frontmatter };

  frontmatter.status = options.status;
  frontmatter.updated = options.timestamp;

  if (options.runId !== undefined) frontmatter.run_id = options.runId;
  if (options.conversationId !== undefined) frontmatter.conversation_id = options.conversationId;
  if (options.sidepanelTabId !== undefined) frontmatter.sidepanel_tab_id = options.sidepanelTabId;
  if (options.heartbeat !== undefined) frontmatter.heartbeat = options.heartbeat;
  if (options.pauseReason !== undefined) frontmatter.pause_reason = options.pauseReason;

  if (options.status === 'running') {
    frontmatter.started = options.timestamp;
  }

  if (options.status === 'done' || options.status === 'failed' || options.status === 'canceled') {
    frontmatter.finished = options.timestamp;
    frontmatter.heartbeat = null;
    frontmatter.pause_reason = null;
  }

  return this.withFrontmatter(frontmatter, parsed.task.body);
}

clearPause(content: string, timestamp: string): string {
  return this.writeStatus(content, {
    status: 'running',
    timestamp,
    heartbeat: timestamp,
    pauseReason: null,
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=TaskNoteStore
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/storage/TaskNoteStore.ts tests/unit/features/tasks/storage/TaskNoteStore.test.ts
git commit -m "feat(tasks): write heartbeat and pause_reason via TaskNoteStore"
```

---

### Task 3: ClaudianBlockParser

**Files:**
- Create: `src/features/tasks/execution/ClaudianBlockParser.ts`
- Create: `tests/unit/features/tasks/execution/ClaudianBlockParser.test.ts`

- [ ] **Step 1: Write the failing parser test**

Create `tests/unit/features/tasks/execution/ClaudianBlockParser.test.ts`:

```typescript
import { ClaudianBlockParser } from '../../../../../src/features/tasks/execution/ClaudianBlockParser';

describe('ClaudianBlockParser', () => {
  it('extracts a single progress block', () => {
    const parser = new ClaudianBlockParser();
    const out = parser.feed('Hello <claudian_progress>\nstep: doing thing\ndone: 1/3\n</claudian_progress> world');
    expect(out.plainText).toBe('Hello  world');
    expect(out.blocks).toEqual([
      { kind: 'progress', fields: { step: 'doing thing', done: '1/3' }, raw: expect.any(String) },
    ]);
  });

  it('handles a block split across two chunks', () => {
    const parser = new ClaudianBlockParser();
    const a = parser.feed('text <claudian_needs_input>\nquestion: which env');
    const b = parser.feed(' file?\nwhy: ambiguous\n</claudian_needs_input> tail');
    expect(a.blocks).toEqual([]);
    expect(b.blocks).toEqual([
      { kind: 'needs_input', fields: { question: 'which env file?', why: 'ambiguous' }, raw: expect.any(String) },
    ]);
    expect(a.plainText + b.plainText).toBe('text  tail');
  });

  it('reports malformed block via warning array when a required field is missing', () => {
    const parser = new ClaudianBlockParser();
    const out = parser.feed('<claudian_needs_input>\nwhy: no question\n</claudian_needs_input>');
    expect(out.blocks).toEqual([]);
    expect(out.warnings).toEqual(['needs_input missing required field: question']);
  });

  it('strips unknown fields silently in known blocks', () => {
    const parser = new ClaudianBlockParser();
    const out = parser.feed('<claudian_progress>\nstep: x\nfuture: y\n</claudian_progress>');
    expect(out.blocks).toEqual([
      { kind: 'progress', fields: { step: 'x' }, raw: expect.any(String) },
    ]);
    expect(out.warnings).toEqual([]);
  });

  it('emits multiple blocks in order', () => {
    const parser = new ClaudianBlockParser();
    const out = parser.feed(
      'A <claudian_progress>\nstep: one\n</claudian_progress> B <claudian_progress>\nstep: two\n</claudian_progress> C',
    );
    expect(out.blocks.map((b) => b.fields.step)).toEqual(['one', 'two']);
    expect(out.plainText).toBe('A  B  C');
  });

  it('drops unclosed block at end of stream when finalize called', () => {
    const parser = new ClaudianBlockParser();
    parser.feed('<claudian_progress>\nstep: half');
    const out = parser.finalize();
    expect(out.blocks).toEqual([]);
    expect(out.warnings).toEqual(['progress block was not closed before stream end']);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npm test -- --selectProjects unit --testPathPatterns=ClaudianBlockParser
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/features/tasks/execution/ClaudianBlockParser.ts`:

```typescript
export type ClaudianBlockKind = 'progress' | 'needs_input' | 'needs_approval';

export interface ClaudianBlock {
  kind: ClaudianBlockKind;
  fields: Record<string, string>;
  raw: string;
}

export interface ParserOutput {
  plainText: string;
  blocks: ClaudianBlock[];
  warnings: string[];
}

const KIND_TO_OPEN: Record<ClaudianBlockKind, string> = {
  progress: '<claudian_progress>',
  needs_input: '<claudian_needs_input>',
  needs_approval: '<claudian_needs_approval>',
};

const KIND_TO_CLOSE: Record<ClaudianBlockKind, string> = {
  progress: '</claudian_progress>',
  needs_input: '</claudian_needs_input>',
  needs_approval: '</claudian_needs_approval>',
};

const REQUIRED_FIELDS: Record<ClaudianBlockKind, string[]> = {
  progress: ['step'],
  needs_input: ['question'],
  needs_approval: ['action'],
};

const KNOWN_FIELDS: Record<ClaudianBlockKind, Set<string>> = {
  progress: new Set(['step', 'done', 'note']),
  needs_input: new Set(['question', 'why', 'default']),
  needs_approval: new Set(['action', 'risk', 'reversible']),
};

const ALL_KINDS: ClaudianBlockKind[] = ['progress', 'needs_input', 'needs_approval'];

const MAX_TAIL = 1024;

export class ClaudianBlockParser {
  private buffer = '';
  private openKind: ClaudianBlockKind | null = null;
  private openBody = '';

  feed(chunk: string): ParserOutput {
    this.buffer += chunk;
    const blocks: ClaudianBlock[] = [];
    const warnings: string[] = [];
    let plainText = '';

    while (this.buffer.length > 0) {
      if (this.openKind === null) {
        const next = this.findNextOpen();
        if (!next) {
          // Keep a tail buffer in case an open tag is split across chunks.
          if (this.buffer.length > MAX_TAIL) {
            plainText += this.buffer.slice(0, this.buffer.length - MAX_TAIL);
            this.buffer = this.buffer.slice(-MAX_TAIL);
          }
          break;
        }
        plainText += this.buffer.slice(0, next.index);
        this.openKind = next.kind;
        this.openBody = '';
        this.buffer = this.buffer.slice(next.index + KIND_TO_OPEN[next.kind].length);
      } else {
        const closeTag = KIND_TO_CLOSE[this.openKind];
        const idx = this.buffer.indexOf(closeTag);
        if (idx === -1) {
          // Hold the partial body; wait for more chunks.
          this.openBody += this.buffer;
          this.buffer = '';
          break;
        }
        this.openBody += this.buffer.slice(0, idx);
        const result = parseBody(this.openKind, this.openBody);
        if (result.ok) {
          blocks.push({ kind: this.openKind, fields: result.fields, raw: this.openBody.trim() });
        } else {
          warnings.push(result.error);
        }
        this.buffer = this.buffer.slice(idx + closeTag.length);
        this.openKind = null;
        this.openBody = '';
      }
    }

    // Anything left in `buffer` while no block is open should be drained next call;
    // but if `buffer` ends without a partial open tag prefix, drain it now.
    if (this.openKind === null && this.buffer.length > 0 && !this.bufferEndsWithPartialOpen()) {
      plainText += this.buffer;
      this.buffer = '';
    }

    return { plainText, blocks, warnings };
  }

  finalize(): ParserOutput {
    const warnings: string[] = [];
    let plainText = '';
    if (this.openKind !== null) {
      warnings.push(`${this.openKind} block was not closed before stream end`);
      this.openKind = null;
      this.openBody = '';
    }
    if (this.buffer.length > 0) {
      plainText = this.buffer;
      this.buffer = '';
    }
    return { plainText, blocks: [], warnings };
  }

  private findNextOpen(): { kind: ClaudianBlockKind; index: number } | null {
    let best: { kind: ClaudianBlockKind; index: number } | null = null;
    for (const kind of ALL_KINDS) {
      const idx = this.buffer.indexOf(KIND_TO_OPEN[kind]);
      if (idx === -1) continue;
      if (best === null || idx < best.index) best = { kind, index: idx };
    }
    return best;
  }

  private bufferEndsWithPartialOpen(): boolean {
    for (const kind of ALL_KINDS) {
      const tag = KIND_TO_OPEN[kind];
      for (let i = 1; i < tag.length; i++) {
        if (this.buffer.endsWith(tag.slice(0, i))) return true;
      }
    }
    return false;
  }
}

function parseBody(
  kind: ClaudianBlockKind,
  body: string,
): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  const fields: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  const commit = () => {
    if (currentKey === null) return;
    fields[currentKey] = currentValue.join('\n').trim();
    currentKey = null;
    currentValue = [];
  };

  for (const line of lines) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (match) {
      commit();
      currentKey = match[1];
      currentValue = [match[2]];
    } else if (currentKey !== null) {
      currentValue.push(line);
    }
  }
  commit();

  for (const required of REQUIRED_FIELDS[kind]) {
    if (!fields[required]) return { ok: false, error: `${kind} missing required field: ${required}` };
  }

  const filtered: Record<string, string> = {};
  for (const key of Object.keys(fields)) {
    if (KNOWN_FIELDS[kind].has(key)) filtered[key] = fields[key];
  }
  return { ok: true, fields: filtered };
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=ClaudianBlockParser
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/ClaudianBlockParser.ts tests/unit/features/tasks/execution/ClaudianBlockParser.test.ts
git commit -m "feat(tasks): add ClaudianBlockParser for inline protocol blocks"
```

---

### Task 4: LedgerWriter

**Files:**
- Create: `src/features/tasks/execution/LedgerWriter.ts`
- Create: `tests/unit/features/tasks/execution/LedgerWriter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/tasks/execution/LedgerWriter.test.ts`:

```typescript
import { LedgerWriter } from '../../../../../src/features/tasks/execution/LedgerWriter';
import type { TaskLedgerEntry } from '../../../../../src/features/tasks/model/taskTypes';

function entry(message: string, ts = '2026-06-04T10:00:00Z'): TaskLedgerEntry {
  return { timestamp: ts, status: 'running', message };
}

describe('LedgerWriter', () => {
  it('batches entries and flushes on the interval', async () => {
    jest.useFakeTimers();
    const flushed: TaskLedgerEntry[][] = [];
    const writer = new LedgerWriter({
      flush: async (entries) => { flushed.push(entries); },
      intervalMs: 5000,
      milestoneThreshold: 3,
    });
    writer.enqueue(entry('a'));
    writer.enqueue(entry('b'));
    expect(flushed).toEqual([]);
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(flushed.flat().map((e) => e.message)).toEqual(['a', 'b']);
    writer.dispose();
    jest.useRealTimers();
  });

  it('force-flushes when queue reaches the milestone threshold', async () => {
    const flushed: TaskLedgerEntry[][] = [];
    const writer = new LedgerWriter({
      flush: async (entries) => { flushed.push(entries); },
      intervalMs: 60000,
      milestoneThreshold: 2,
    });
    writer.enqueue(entry('a'));
    writer.enqueue(entry('b'));
    await new Promise((r) => setTimeout(r, 0));
    expect(flushed.flat().map((e) => e.message)).toEqual(['a', 'b']);
    writer.dispose();
  });

  it('exposes the recent tail bounded to 20 entries', () => {
    const writer = new LedgerWriter({ flush: async () => {}, intervalMs: 60000, milestoneThreshold: 999 });
    for (let i = 0; i < 25; i++) writer.enqueue(entry(`m${i}`));
    expect(writer.tail().length).toBe(20);
    expect(writer.tail()[0].message).toBe('m5');
    expect(writer.tail()[19].message).toBe('m24');
    writer.dispose();
  });

  it('retries a failed flush with backoff and drops after two attempts', async () => {
    jest.useFakeTimers();
    let attempts = 0;
    const degraded = jest.fn();
    const writer = new LedgerWriter({
      flush: async () => { attempts += 1; throw new Error('boom'); },
      intervalMs: 5000,
      milestoneThreshold: 999,
      onDegraded: degraded,
    });
    writer.enqueue(entry('x'));
    jest.advanceTimersByTime(5000);
    await Promise.resolve(); await Promise.resolve();
    expect(attempts).toBe(1);
    jest.advanceTimersByTime(5000);
    await Promise.resolve(); await Promise.resolve();
    expect(attempts).toBe(2);
    jest.advanceTimersByTime(30000);
    await Promise.resolve(); await Promise.resolve();
    expect(degraded).toHaveBeenCalledTimes(1);
    writer.dispose();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npm test -- --selectProjects unit --testPathPatterns=LedgerWriter
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement LedgerWriter**

Create `src/features/tasks/execution/LedgerWriter.ts`:

```typescript
import type { TaskLedgerEntry } from '../model/taskTypes';

export interface LedgerWriterOptions {
  flush: (entries: TaskLedgerEntry[]) => Promise<void>;
  intervalMs: number;
  milestoneThreshold: number;
  onDegraded?: () => void;
}

const TAIL_CAP = 20;
const RETRY_BACKOFF_MS = [5000, 30000];

export class LedgerWriter {
  private queue: TaskLedgerEntry[] = [];
  private tailBuffer: TaskLedgerEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private retryAttempt = 0;
  private disposed = false;

  constructor(private readonly opts: LedgerWriterOptions) {
    this.scheduleInterval();
  }

  enqueue(entry: TaskLedgerEntry): void {
    if (this.disposed) return;
    this.queue.push(entry);
    this.tailBuffer.push(entry);
    if (this.tailBuffer.length > TAIL_CAP) {
      this.tailBuffer.splice(0, this.tailBuffer.length - TAIL_CAP);
    }
    if (this.queue.length >= this.opts.milestoneThreshold) {
      void this.flushNow();
    }
  }

  async flushNow(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    const batch = this.queue.slice();
    this.queue.length = 0;
    this.flushing = true;
    try {
      await this.opts.flush(batch);
      this.retryAttempt = 0;
    } catch {
      this.retryAttempt += 1;
      if (this.retryAttempt > RETRY_BACKOFF_MS.length) {
        this.opts.onDegraded?.();
      } else {
        // Re-queue at the front and schedule a retry.
        this.queue = [...batch, ...this.queue];
        this.scheduleRetry();
      }
    } finally {
      this.flushing = false;
    }
  }

  tail(): TaskLedgerEntry[] {
    return [...this.tailBuffer];
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleInterval(): void {
    if (this.disposed) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow().then(() => this.scheduleInterval());
    }, this.opts.intervalMs);
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = RETRY_BACKOFF_MS[this.retryAttempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow().then(() => this.scheduleInterval());
    }, delay);
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=LedgerWriter
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/LedgerWriter.ts tests/unit/features/tasks/execution/LedgerWriter.test.ts
git commit -m "feat(tasks): add LedgerWriter with debounced flush and retry"
```

---

### Task 5: ProviderStreamAdapter interface + synthetic adapter

**Files:**
- Create: `src/features/tasks/execution/ProviderStreamAdapter.ts`
- Create: `tests/helpers/SyntheticStreamAdapter.ts`

- [ ] **Step 1: Define the interface**

Create `src/features/tasks/execution/ProviderStreamAdapter.ts`:

```typescript
export interface StreamToolUse {
  name: string;
  primaryArg: string | null;
}

export interface StreamHandlers {
  onText(chunk: string): void;
  onToolUse(tool: StreamToolUse): void;
  onToolResult(name: string, ok: boolean): void;
  onError(error: string): void;
  onEnd(payload: {
    status: 'completed' | 'failed' | 'canceled';
    finalAssistantContent: string;
    error?: string;
  }): void;
}

export interface ProviderStreamAdapter {
  subscribe(handlers: StreamHandlers): () => void;
  sendFollowUp(content: string): Promise<void>;
  cancel(): void;
}
```

- [ ] **Step 2: Add a synthetic adapter test helper**

Create `tests/helpers/SyntheticStreamAdapter.ts`:

```typescript
import type {
  ProviderStreamAdapter,
  StreamHandlers,
  StreamToolUse,
} from '../../src/features/tasks/execution/ProviderStreamAdapter';

type EndPayload = Parameters<StreamHandlers['onEnd']>[0];

export class SyntheticStreamAdapter implements ProviderStreamAdapter {
  followUps: string[] = [];
  canceled = false;
  private handlers: StreamHandlers | null = null;

  subscribe(handlers: StreamHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  async sendFollowUp(content: string): Promise<void> {
    this.followUps.push(content);
  }

  cancel(): void {
    this.canceled = true;
  }

  emitText(chunk: string): void { this.handlers?.onText(chunk); }
  emitToolUse(tool: StreamToolUse): void { this.handlers?.onToolUse(tool); }
  emitToolResult(name: string, ok: boolean): void { this.handlers?.onToolResult(name, ok); }
  emitError(error: string): void { this.handlers?.onError(error); }
  emitEnd(payload: EndPayload): void { this.handlers?.onEnd(payload); }
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0. (No tests yet for this task; the helper is consumed by Task 7's RunSession tests.)

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/execution/ProviderStreamAdapter.ts tests/helpers/SyntheticStreamAdapter.ts
git commit -m "feat(tasks): add ProviderStreamAdapter interface and synthetic helper"
```

---

### Task 6: Event bus additions

**Files:**
- Modify: `src/features/tasks/events.ts`

- [ ] **Step 1: Add new event keys to TaskEventMap**

Edit `src/features/tasks/events.ts`. Replace the file with:

```typescript
import type { TaskStatus } from './model/taskTypes';
import type { TaskLedgerEntry } from './model/taskTypes';

export interface TaskEventMap {
  /** Emitted when Agent Board configuration (lanes/folder) changes. */
  'task:board-config-changed': void;
  /** Emitted when a work-order run begins. */
  'task:run-started': { taskId: string; path: string };
  /** Emitted whenever a work order's status is written. */
  'task:status-changed': { taskId: string; path: string; status: TaskStatus };
  /** Emitted when a work-order run ends. */
  'task:run-finished': { taskId: string; path: string; status: TaskStatus };

  /** Emitted at the start of every attempt entering `running`. */
  'task:attempt-started': { taskId: string; path: string; attemptNumber: number };
  /** Emitted whenever a ledger entry has been queued for write. */
  'task:ledger-appended': { taskId: string; path: string; entry: TaskLedgerEntry };
  /** Emitted on each heartbeat tick. */
  'task:heartbeat': { taskId: string; path: string; at: string };
  /** Emitted when the agent emits a <claudian_progress> block. */
  'task:progress': { taskId: string; path: string; step: string; done?: { complete: number; total: number } };
  /** Emitted when the run pauses for user input. */
  'task:needs-input': { taskId: string; path: string; question: string; why?: string; default?: string; runId: string };
  /** Emitted when the run pauses for user approval. */
  'task:needs-approval': { taskId: string; path: string; action: string; risk?: string; reversible?: boolean; runId: string };
  /** Emitted when the run resumes after a pause. */
  'task:resumed': { taskId: string; path: string };
  /** Emitted when a run ends without a parseable handoff but with content. */
  'task:needs-handoff': { taskId: string; path: string; error: string };
  /** Emitted when the parser drops a malformed claudian_* block. */
  'task:parser-warning': { taskId: string; path: string; warning: string };
  /** Emitted when LedgerWriter has given up flushing after retries. */
  'task:ledger-flush-degraded': { taskId: string; path: string };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0. (Consumers are added in Tasks 7 and 16.)

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/events.ts
git commit -m "feat(tasks): expand TaskEventMap for live-run visibility"
```

---

### Task 7: RunSession

**Files:**
- Create: `src/features/tasks/execution/RunSession.ts`
- Create: `tests/unit/features/tasks/execution/RunSession.test.ts`

- [ ] **Step 1: Write the failing happy-path test**

Create `tests/unit/features/tasks/execution/RunSession.test.ts`:

```typescript
import { EventBus } from '../../../../../src/core/events/EventBus';
import { RunSession } from '../../../../../src/features/tasks/execution/RunSession';
import type { TaskEventMap } from '../../../../../src/features/tasks/events';
import type { TaskLedgerEntry, TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';
import { SyntheticStreamAdapter } from '../../../../helpers/SyntheticStreamAdapter';

const VALID_HANDOFF = `<claudian_handoff>
summary: Done.
verification: Tests pass.
risks: None.
next_action: Review.
</claudian_handoff>`;

function makeTask(overrides: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: 'Agent Board/tasks/t1.md',
    raw: '',
    body: '',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 't1',
      title: 'T1',
      status: 'ready',
      priority: '2 - normal',
      created: '2026-06-04T08:00:00Z',
      updated: '2026-06-04T08:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      attempts: 0,
      ...overrides,
    },
    sections: {
      objective: 'Do',
      acceptanceCriteria: '- [ ] x',
      context: '',
      constraints: '',
      ledger: '',
      handoff: '',
    },
  };
}

function makeSession(overrides: Partial<ConstructorParameters<typeof RunSession>[0]> = {}) {
  const adapter = new SyntheticStreamAdapter();
  const events = new EventBus<TaskEventMap>();
  const statuses: string[] = [];
  const ledger: TaskLedgerEntry[] = [];
  const handoffs: string[] = [];
  const session = new RunSession({
    task: makeTask(),
    runId: 'run-1',
    conversationId: 'conv-1',
    sidepanelTabId: 'tab-1',
    stream: adapter,
    events,
    now: () => '2026-06-04T09:00:00Z',
    writeStatus: async (_t, options) => { statuses.push(options.status); },
    flushLedger: async (entries) => { ledger.push(...entries); },
    writeHandoff: async (_t, md) => { handoffs.push(md); },
    heartbeatIntervalMs: 1000,
    staleThresholdMs: 5000,
    ledgerIntervalMs: 1000,
    ledgerMilestone: 999,
    ...overrides,
  });
  return { session, adapter, events, statuses, ledger, handoffs };
}

describe('RunSession', () => {
  it('writes running status + Run started ledger, then handles a clean end-to-end run', async () => {
    const { session, adapter, statuses, ledger, handoffs } = makeSession();
    const terminal = session.run();
    expect(statuses[0]).toBe('running');
    adapter.emitText('Working… ');
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'Working… ' + VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(statuses).toEqual(['running', 'review']);
    expect(ledger.map((e) => e.message)).toEqual(expect.arrayContaining(['Run started (attempt 1)', 'Handoff written.']));
    expect(handoffs.length).toBe(1);
  });

  it('transitions to needs_input on <claudian_needs_input> and resumes via sendFollowUp', async () => {
    jest.useFakeTimers();
    const { session, adapter, events, statuses, ledger } = makeSession();
    const seen: TaskEventMap['task:needs-input'][] = [];
    events.on('task:needs-input', (p) => seen.push(p));
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: which env?\n</claudian_needs_input>');
    await Promise.resolve();
    expect(statuses).toEqual(['running', 'needs_input']);
    expect(seen[0].question).toBe('which env?');
    await session.resume({ kind: 'reply', content: '.env.local' });
    expect(adapter.followUps).toEqual(['.env.local']);
    expect(statuses).toEqual(['running', 'needs_input', 'running']);
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await terminal;
    expect(ledger.find((e) => e.message.startsWith('resumed:'))).toBeTruthy();
    jest.useRealTimers();
  });

  it('rejected approval cancels the run with reason', async () => {
    const { session, adapter, statuses, ledger } = makeSession();
    const terminal = session.run();
    adapter.emitText('<claudian_needs_approval>\naction: drop table\n</claudian_needs_approval>');
    await Promise.resolve();
    await session.resume({ kind: 'reject', reason: 'too risky' });
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses).toEqual(['running', 'needs_approval', 'canceled']);
    expect(ledger.find((e) => e.message.includes('rejected: too risky'))).toBeTruthy();
  });

  it('lands in needs_handoff when stream completes with content but no handoff block', async () => {
    const { session, adapter, statuses } = makeSession();
    const terminal = session.run();
    adapter.emitText('did stuff but no handoff');
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'did stuff but no handoff' });
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses).toEqual(['running', 'needs_handoff']);
  });

  it('fails with heartbeat lost when no events arrive within the stale threshold', async () => {
    jest.useFakeTimers();
    const { session, statuses } = makeSession({ staleThresholdMs: 2000, heartbeatIntervalMs: 500 });
    const terminal = session.run();
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('failed');
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npm test -- --selectProjects unit --testPathPatterns=RunSession
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement RunSession**

Create `src/features/tasks/execution/RunSession.ts`:

```typescript
import type { EventBus } from '../../../core/events/EventBus';
import type { TaskEventMap } from '../events';
import type { TaskLedgerEntry, TaskSpec, TaskStatus } from '../model/taskTypes';
import { ClaudianBlockParser, type ClaudianBlock } from './ClaudianBlockParser';
import { LedgerWriter } from './LedgerWriter';
import type { ProviderStreamAdapter } from './ProviderStreamAdapter';
import { parseTaskHandoff } from './TaskHandoffParser';

export interface RunSessionWriteStatusOptions {
  status: TaskStatus;
  timestamp: string;
  runId?: string | null;
  conversationId?: string | null;
  sidepanelTabId?: string | null;
  heartbeat?: string | null;
  pauseReason?: string | null;
}

export interface RunSessionDeps {
  task: TaskSpec;
  runId: string;
  conversationId: string | null;
  sidepanelTabId: string | null;
  stream: ProviderStreamAdapter;
  events: EventBus<TaskEventMap>;
  now: () => string;
  writeStatus: (task: TaskSpec, options: RunSessionWriteStatusOptions) => Promise<void>;
  flushLedger: (entries: TaskLedgerEntry[]) => Promise<void>;
  writeHandoff: (task: TaskSpec, markdown: string) => Promise<void>;
  heartbeatIntervalMs?: number;
  staleThresholdMs?: number;
  ledgerIntervalMs?: number;
  ledgerMilestone?: number;
}

export type RunSessionResult = { ok: true; status: TaskStatus } | { ok: false; error: string; status: TaskStatus };

export type ResumeArg =
  | { kind: 'reply'; content: string }
  | { kind: 'approve' }
  | { kind: 'reject'; reason: string };

const DEFAULTS = {
  heartbeatIntervalMs: 30_000,
  staleThresholdMs: 300_000,
  ledgerIntervalMs: 5_000,
  ledgerMilestone: 3,
};

export class RunSession {
  private readonly parser = new ClaudianBlockParser();
  private readonly ledger: LedgerWriter;
  private lastEvent: number = Date.now();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private resolveTerminal: ((r: RunSessionResult) => void) | null = null;
  private terminalPromise: Promise<RunSessionResult>;
  private paused = false;
  private finalContentBuffer = '';
  private attemptNumber = 0;

  constructor(private readonly deps: RunSessionDeps) {
    this.ledger = new LedgerWriter({
      flush: async (entries) => {
        await this.deps.flushLedger(entries);
        for (const e of entries) {
          this.deps.events.emit('task:ledger-appended', {
            taskId: this.deps.task.frontmatter.id,
            path: this.deps.task.path,
            entry: e,
          });
        }
      },
      intervalMs: deps.ledgerIntervalMs ?? DEFAULTS.ledgerIntervalMs,
      milestoneThreshold: deps.ledgerMilestone ?? DEFAULTS.ledgerMilestone,
      onDegraded: () => {
        this.deps.events.emit('task:ledger-flush-degraded', {
          taskId: this.deps.task.frontmatter.id,
          path: this.deps.task.path,
        });
      },
    });
    this.terminalPromise = new Promise((resolve) => { this.resolveTerminal = resolve; });
  }

  run(): Promise<RunSessionResult> {
    this.attemptNumber = (this.deps.task.frontmatter.attempts ?? 0) + 1;
    void this.startAsync();
    return this.terminalPromise;
  }

  private async startAsync(): Promise<void> {
    const ts = this.deps.now();
    await this.deps.writeStatus(this.deps.task, {
      status: 'running',
      timestamp: ts,
      runId: this.deps.runId,
      conversationId: this.deps.conversationId,
      sidepanelTabId: this.deps.sidepanelTabId,
      heartbeat: ts,
    });
    this.deps.events.emit('task:attempt-started', {
      taskId: this.deps.task.frontmatter.id,
      path: this.deps.task.path,
      attemptNumber: this.attemptNumber,
    });
    this.ledger.enqueue({ timestamp: ts, status: 'running', message: `Run started (attempt ${this.attemptNumber})` });
    this.unsubscribe = this.deps.stream.subscribe({
      onText: (chunk) => this.handleText(chunk),
      onToolUse: (tool) => this.handleTool(tool.name, tool.primaryArg),
      onToolResult: () => { this.touch(); },
      onError: (error) => this.handleError(error),
      onEnd: (payload) => { void this.finish(payload); },
    });
    this.startHeartbeat();
  }

  async resume(arg: ResumeArg): Promise<void> {
    if (!this.paused) return;
    if (arg.kind === 'reject') {
      const ts = this.deps.now();
      this.ledger.enqueue({ timestamp: ts, status: 'canceled', message: `rejected: ${arg.reason}` });
      await this.ledger.flushNow();
      await this.deps.writeStatus(this.deps.task, {
        status: 'canceled',
        timestamp: ts,
        pauseReason: null,
      });
      this.deps.events.emit('task:status-changed', {
        taskId: this.deps.task.frontmatter.id,
        path: this.deps.task.path,
        status: 'canceled',
      });
      this.teardown();
      this.resolveTerminal?.({ ok: false, error: `rejected: ${arg.reason}`, status: 'canceled' });
      return;
    }
    const content = arg.kind === 'reply' ? arg.content : 'approved';
    const ts = this.deps.now();
    await this.deps.writeStatus(this.deps.task, {
      status: 'running',
      timestamp: ts,
      heartbeat: ts,
      pauseReason: null,
    });
    this.deps.events.emit('task:status-changed', {
      taskId: this.deps.task.frontmatter.id,
      path: this.deps.task.path,
      status: 'running',
    });
    this.deps.events.emit('task:resumed', {
      taskId: this.deps.task.frontmatter.id,
      path: this.deps.task.path,
    });
    this.ledger.enqueue({
      timestamp: ts,
      status: 'running',
      message: `resumed: ${truncate(content, 80)}`,
    });
    this.paused = false;
    this.startHeartbeat();
    await this.deps.stream.sendFollowUp(content);
  }

  cancel(reason = 'stopped by user'): void {
    const ts = this.deps.now();
    this.ledger.enqueue({ timestamp: ts, status: 'canceled', message: reason });
    this.deps.stream.cancel();
    void this.finish({ status: 'canceled', finalAssistantContent: this.finalContentBuffer });
  }

  private handleText(chunk: string): void {
    this.touch();
    this.finalContentBuffer += chunk;
    const out = this.parser.feed(chunk);
    for (const w of out.warnings) {
      this.deps.events.emit('task:parser-warning', {
        taskId: this.deps.task.frontmatter.id,
        path: this.deps.task.path,
        warning: w,
      });
      this.ledger.enqueue({
        timestamp: this.deps.now(),
        status: 'running',
        message: `(parser) ${w}`,
      });
    }
    for (const block of out.blocks) {
      if (this.paused) {
        this.deps.events.emit('task:parser-warning', {
          taskId: this.deps.task.frontmatter.id,
          path: this.deps.task.path,
          warning: `ignored second pause block while already paused: ${block.kind}`,
        });
        continue;
      }
      if (block.kind === 'progress') this.handleProgress(block);
      else if (block.kind === 'needs_input') void this.handlePause('needs_input', block);
      else if (block.kind === 'needs_approval') void this.handlePause('needs_approval', block);
    }
  }

  private handleProgress(block: ClaudianBlock): void {
    const step = block.fields.step ?? '';
    const doneStr = block.fields.done;
    let done: { complete: number; total: number } | undefined;
    if (doneStr) {
      const match = doneStr.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (match) done = { complete: parseInt(match[1], 10), total: parseInt(match[2], 10) };
    }
    this.ledger.enqueue({
      timestamp: this.deps.now(),
      status: 'running',
      message: `progress: ${truncate(step, 120)}`,
    });
    this.deps.events.emit('task:progress', {
      taskId: this.deps.task.frontmatter.id,
      path: this.deps.task.path,
      step,
      done,
    });
  }

  private async handlePause(kind: 'needs_input' | 'needs_approval', block: ClaudianBlock): Promise<void> {
    this.paused = true;
    const ts = this.deps.now();
    const reason = kind === 'needs_input' ? block.fields.question : block.fields.action;
    await this.ledger.flushNow();
    await this.deps.writeStatus(this.deps.task, {
      status: kind,
      timestamp: ts,
      pauseReason: reason ?? null,
    });
    this.deps.events.emit('task:status-changed', {
      taskId: this.deps.task.frontmatter.id,
      path: this.deps.task.path,
      status: kind,
    });
    if (kind === 'needs_input') {
      this.deps.events.emit('task:needs-input', {
        taskId: this.deps.task.frontmatter.id,
        path: this.deps.task.path,
        question: block.fields.question,
        why: block.fields.why,
        default: block.fields.default,
        runId: this.deps.runId,
      });
    } else {
      this.deps.events.emit('task:needs-approval', {
        taskId: this.deps.task.frontmatter.id,
        path: this.deps.task.path,
        action: block.fields.action,
        risk: block.fields.risk,
        reversible: block.fields.reversible === 'true' ? true : block.fields.reversible === 'false' ? false : undefined,
        runId: this.deps.runId,
      });
    }
    this.stopHeartbeat();
  }

  private handleTool(name: string, primaryArg: string | null): void {
    this.touch();
    const arg = primaryArg ? ` ${truncate(primaryArg, 60)}` : '';
    this.ledger.enqueue({
      timestamp: this.deps.now(),
      status: 'running',
      message: `tool: ${name}${arg}`,
    });
  }

  private handleError(error: string): void {
    void this.finish({ status: 'failed', finalAssistantContent: this.finalContentBuffer, error });
  }

  private async finish(payload: {
    status: 'completed' | 'failed' | 'canceled';
    finalAssistantContent: string;
    error?: string;
  }): Promise<void> {
    if (this.resolveTerminal === null) return;
    this.teardown();
    const finalOut = this.parser.finalize();
    for (const w of finalOut.warnings) {
      this.deps.events.emit('task:parser-warning', {
        taskId: this.deps.task.frontmatter.id,
        path: this.deps.task.path,
        warning: w,
      });
    }
    await this.ledger.flushNow();
    const ts = this.deps.now();
    if (payload.status === 'canceled') {
      await this.deps.writeStatus(this.deps.task, { status: 'canceled', timestamp: ts });
      this.deps.events.emit('task:status-changed', { taskId: this.deps.task.frontmatter.id, path: this.deps.task.path, status: 'canceled' });
      const resolver = this.resolveTerminal; this.resolveTerminal = null;
      resolver({ ok: false, error: payload.error ?? 'canceled', status: 'canceled' });
      return;
    }
    if (payload.status === 'failed') {
      this.ledger.enqueue({ timestamp: ts, status: 'failed', message: payload.error ?? 'Run failed.' });
      await this.ledger.flushNow();
      await this.deps.writeStatus(this.deps.task, { status: 'failed', timestamp: ts });
      this.deps.events.emit('task:status-changed', { taskId: this.deps.task.frontmatter.id, path: this.deps.task.path, status: 'failed' });
      const resolver = this.resolveTerminal; this.resolveTerminal = null;
      resolver({ ok: false, error: payload.error ?? 'failed', status: 'failed' });
      return;
    }
    // completed
    const content = payload.finalAssistantContent;
    const parsed = parseTaskHandoff(content);
    if (parsed.ok) {
      await this.deps.writeHandoff(this.deps.task, parsed.handoff.markdown);
      await this.deps.writeStatus(this.deps.task, { status: 'review', timestamp: ts });
      this.ledger.enqueue({ timestamp: ts, status: 'review', message: 'Handoff written.' });
      await this.ledger.flushNow();
      this.deps.events.emit('task:status-changed', { taskId: this.deps.task.frontmatter.id, path: this.deps.task.path, status: 'review' });
      const resolver = this.resolveTerminal; this.resolveTerminal = null;
      resolver({ ok: true, status: 'review' });
      return;
    }
    if (content.length > 0) {
      await this.deps.writeStatus(this.deps.task, { status: 'needs_handoff', timestamp: ts });
      this.ledger.enqueue({ timestamp: ts, status: 'needs_handoff', message: parsed.error });
      await this.ledger.flushNow();
      this.deps.events.emit('task:status-changed', { taskId: this.deps.task.frontmatter.id, path: this.deps.task.path, status: 'needs_handoff' });
      this.deps.events.emit('task:needs-handoff', { taskId: this.deps.task.frontmatter.id, path: this.deps.task.path, error: parsed.error });
      const resolver = this.resolveTerminal; this.resolveTerminal = null;
      resolver({ ok: false, error: parsed.error, status: 'needs_handoff' });
      return;
    }
    await this.deps.writeStatus(this.deps.task, { status: 'failed', timestamp: ts });
    this.ledger.enqueue({ timestamp: ts, status: 'failed', message: 'Empty response' });
    await this.ledger.flushNow();
    this.deps.events.emit('task:status-changed', { taskId: this.deps.task.frontmatter.id, path: this.deps.task.path, status: 'failed' });
    const resolver = this.resolveTerminal; this.resolveTerminal = null;
    resolver({ ok: false, error: 'Empty response', status: 'failed' });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastEvent = Date.now();
    const interval = this.deps.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs;
    const stale = this.deps.staleThresholdMs ?? DEFAULTS.staleThresholdMs;
    this.heartbeatTimer = setInterval(() => {
      const at = this.deps.now();
      void this.deps.writeStatus(this.deps.task, { status: 'running', timestamp: at, heartbeat: at });
      this.deps.events.emit('task:heartbeat', { taskId: this.deps.task.frontmatter.id, path: this.deps.task.path, at });
    }, interval);
    this.staleTimer = setInterval(() => {
      if (Date.now() - this.lastEvent > stale) {
        void this.finish({ status: 'failed', finalAssistantContent: this.finalContentBuffer, error: `heartbeat lost (no events for ${Math.round(stale / 60_000)}m)` });
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.staleTimer) { clearInterval(this.staleTimer); this.staleTimer = null; }
  }

  private teardown(): void {
    this.stopHeartbeat();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ledger.dispose();
  }

  private touch(): void {
    this.lastEvent = Date.now();
  }
}

function truncate(value: string, n: number): string {
  if (value.length <= n) return value;
  return value.slice(0, n - 1) + '…';
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=RunSession
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/RunSession.ts tests/unit/features/tasks/execution/RunSession.test.ts
git commit -m "feat(tasks): add RunSession per-run lifecycle owner"
```

---

### Task 8: TaskExecutionSurface contract + ChatTabExecutionSurface impl + ClaudianView return shape

**Files:**
- Modify: `src/features/tasks/execution/TaskExecutionSurface.ts`
- Modify: `src/features/tasks/execution/ChatTabExecutionSurface.ts`
- Modify: `src/features/chat/ClaudianView.ts`

- [ ] **Step 1: Update the surface interface**

Edit `src/features/tasks/execution/TaskExecutionSurface.ts` to:

```typescript
import type { TaskSpec } from '../model/taskTypes';
import type { ProviderStreamAdapter } from './ProviderStreamAdapter';

export interface TaskRunOptions {
  prompt: string;
}

export interface TaskRunTerminal {
  status: 'completed' | 'failed' | 'canceled';
  finalAssistantContent: string;
  error?: string;
}

export interface TaskRunHandle {
  runId: string;
  conversationId: string | null;
  sidepanelTabId: string | null;
  stream: ProviderStreamAdapter;
  terminal: Promise<TaskRunTerminal>;
}

export interface TaskExecutionSurface {
  startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle>;
  cancelTaskRun?(runId: string): void;
}
```

- [ ] **Step 2: Update ChatTabExecutionSurface**

Edit `src/features/tasks/execution/ChatTabExecutionSurface.ts`. Replace the file with:

```typescript
import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import type { TaskSpec } from '../model/taskTypes';
import type { ProviderStreamAdapter, StreamHandlers } from './ProviderStreamAdapter';
import type { TaskExecutionSurface, TaskRunHandle, TaskRunOptions, TaskRunTerminal } from './TaskExecutionSurface';

class FailedAdapter implements ProviderStreamAdapter {
  subscribe(_handlers: StreamHandlers): () => void { return () => {}; }
  async sendFollowUp(_content: string): Promise<void> { /* no-op */ }
  cancel(): void { /* no-op */ }
}

export class ChatTabExecutionSurface implements TaskExecutionSurface {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle> {
    const { provider, model } = task.frontmatter;
    if (!provider) return this.failed('Work order is missing provider');
    if (!model) return this.failed('Work order is missing model');

    let view = this.plugin.getView();
    if (!view) {
      await this.plugin.activateView();
      view = this.plugin.getView();
    }
    if (!view) return this.failed('Could not open the Claudian chat view.');

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = await view.startTaskRunInFreshTab({
      providerId: provider as ProviderId,
      model,
      prompt: options.prompt,
    });
    if (!handle) {
      return this.failed('Could not open a chat tab for the work order (tab limit reached?).');
    }
    return {
      runId,
      conversationId: handle.conversationId,
      sidepanelTabId: handle.sidepanelTabId,
      stream: handle.stream,
      terminal: handle.terminal,
    };
  }

  private failed(error: string): TaskRunHandle {
    const terminal: TaskRunTerminal = { status: 'failed', finalAssistantContent: '', error };
    return {
      runId: '',
      conversationId: null,
      sidepanelTabId: null,
      stream: new FailedAdapter(),
      terminal: Promise.resolve(terminal),
    };
  }
}
```

- [ ] **Step 3: Update ClaudianView.startTaskRunInFreshTab return shape**

Edit `src/features/chat/ClaudianView.ts`. Locate `startTaskRunInFreshTab` (around line 671). Replace its signature and body with:

```typescript
async startTaskRunInFreshTab(options: {
  providerId: ProviderId;
  model: string;
  prompt: string;
}): Promise<{
  conversationId: string | null;
  sidepanelTabId: string | null;
  stream: ProviderStreamAdapter;
  terminal: Promise<TaskRunTerminal>;
} | null> {
  if (!this.tabManager) return null;
  const tab = await this.tabManager.createTaskRunTab({
    providerId: options.providerId,
    model: options.model,
  });
  if (!tab) return null;
  const inputController = tab.controllers.inputController;
  if (!inputController) return null;

  const factory = ProviderWorkspaceRegistry.getStreamAdapterFactory(options.providerId);
  const stream = factory.createForTab(tab);

  const terminal = (inputController.sendMessage({ content: options.prompt }) as Promise<{
    status: 'completed' | 'failed' | 'canceled';
    finalAssistantContent: string;
    error?: string;
  }>).then((r) => ({
    status: r.status,
    finalAssistantContent: r.finalAssistantContent,
    error: r.error,
  }));
  return {
    conversationId: tab.conversationId,
    sidepanelTabId: tab.id,
    stream,
    terminal,
  };
}
```

Add the imports near the top of `ClaudianView.ts` if missing:

```typescript
import type { ProviderStreamAdapter } from '../tasks/execution/ProviderStreamAdapter';
import type { TaskRunTerminal } from '../tasks/execution/TaskExecutionSurface';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
```

- [ ] **Step 4: Stub `getStreamAdapterFactory` so the type-check passes**

Edit `src/core/providers/ProviderWorkspaceRegistry.ts` and add (placing near other registry getters):

```typescript
import type { ProviderStreamAdapter } from '../../features/tasks/execution/ProviderStreamAdapter';
import type { TaskRunChatTab } from '../../features/chat/tabs/types';

export interface ProviderStreamAdapterFactory {
  createForTab(tab: TaskRunChatTab): ProviderStreamAdapter;
}

// Default no-op factory used until per-provider adapters are wired in Tasks 11-14.
const NULL_STREAM_FACTORY: ProviderStreamAdapterFactory = {
  createForTab() {
    return {
      subscribe: () => () => {},
      sendFollowUp: async () => {},
      cancel: () => {},
    };
  },
};

const streamFactories = new Map<string, ProviderStreamAdapterFactory>();

export class ProviderWorkspaceRegistry {
  // ... existing members ...

  static registerStreamAdapterFactory(providerId: string, factory: ProviderStreamAdapterFactory): void {
    streamFactories.set(providerId, factory);
  }

  static getStreamAdapterFactory(providerId: string): ProviderStreamAdapterFactory {
    return streamFactories.get(providerId) ?? NULL_STREAM_FACTORY;
  }
}
```

(Use the existing class declaration; add only the two new static methods and the supporting types/imports. If the existing file already exports `ProviderWorkspaceRegistry` as `export class`, place new methods inside the existing class block.)

Also export `TaskRunChatTab` from `src/features/chat/tabs/types.ts` if it isn't already — it should be the shape returned by `tabManager.createTaskRunTab`. If a precise type isn't yet exported, add:

```typescript
export interface TaskRunChatTab {
  id: string;
  conversationId: string | null;
  controllers: { inputController: { sendMessage(args: { content: string }): Promise<unknown> } };
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/execution/TaskExecutionSurface.ts src/features/tasks/execution/ChatTabExecutionSurface.ts src/features/chat/ClaudianView.ts src/core/providers/ProviderWorkspaceRegistry.ts src/features/chat/tabs/types.ts
git commit -m "feat(tasks): adopt stream+terminal handle shape on the execution surface"
```

---

### Task 9: TaskRunCoordinator delegates to RunSession

**Files:**
- Modify: `src/features/tasks/execution/TaskRunCoordinator.ts`
- Modify: `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`

- [ ] **Step 1: Update existing tests to the new shape**

The coordinator tests currently construct a `FakeSurface` that returns the old `TaskRunHandle`. Rewrite the helper to use the new handle:

In `tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts`, replace `class FakeSurface` and `makeCoordinator` with:

```typescript
import { SyntheticStreamAdapter } from '../../../../helpers/SyntheticStreamAdapter';
import type { TaskRunTerminal } from '../../../../../src/features/tasks/execution/TaskExecutionSurface';

class FakeSurface implements TaskExecutionSurface {
  prompts: string[] = [];
  readonly adapter = new SyntheticStreamAdapter();
  constructor(private readonly terminal: TaskRunTerminal) {}
  async startTaskRun(_task: TaskSpec, options: { prompt: string }): Promise<TaskRunHandle> {
    this.prompts.push(options.prompt);
    return {
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      stream: this.adapter,
      terminal: Promise.resolve(this.terminal),
    };
  }
}

function makeCoordinator(terminal: TaskRunTerminal) {
  const statuses: string[] = [];
  const ledgerMessages: string[] = [];
  const handoffs: string[] = [];
  const surface = new FakeSurface(terminal);
  const events = new EventBus<TaskEventMap>();
  const coordinator = new TaskRunCoordinator({
    executionSurface: surface,
    events,
    now: () => '2026-05-28T18:10:00+02:00',
    isProviderEnabled: () => true,
    ownsModel: () => true,
    writeTaskStatus: async (_t, options) => { statuses.push(options.status); },
    flushLedger: async (_t, entries) => { for (const e of entries) ledgerMessages.push(e.message); },
    writeHandoff: async (_t, markdown) => { handoffs.push(markdown); },
  });
  return { coordinator, statuses, ledgerMessages, handoffs, surface };
}
```

Update the import line at the top:

```typescript
import { EventBus } from '../../../../../src/core/events/EventBus';
import type { TaskEventMap } from '../../../../../src/features/tasks/events';
```

Existing test bodies should still work — they pass a terminal value and expect statuses/ledger/handoffs.

- [ ] **Step 2: Run tests to confirm new failures**

```bash
npm test -- --selectProjects unit --testPathPatterns=TaskRunCoordinator
```

Expected: FAIL — `TaskRunCoordinator` deps signature differs (`appendLedger` removed, `flushLedger` added, `events` added).

- [ ] **Step 3: Refactor `TaskRunCoordinator`**

Edit `src/features/tasks/execution/TaskRunCoordinator.ts`. Replace its contents:

```typescript
import type { EventBus } from '../../../core/events/EventBus';
import type { TaskEventMap } from '../events';
import type { TaskLedgerEntry, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';
import { RunSession, type RunSessionResult, type RunSessionWriteStatusOptions } from './RunSession';
import type { TaskExecutionSurface } from './TaskExecutionSurface';

export interface TaskRunCoordinatorDeps {
  executionSurface: TaskExecutionSurface;
  events: EventBus<TaskEventMap>;
  now: () => string;
  isProviderEnabled: (providerId: string) => boolean;
  ownsModel: (providerId: string, model: string) => boolean;
  writeTaskStatus: (task: TaskSpec, options: RunSessionWriteStatusOptions) => Promise<void>;
  flushLedger: (task: TaskSpec, entries: TaskLedgerEntry[]) => Promise<void>;
  writeHandoff: (task: TaskSpec, markdown: string) => Promise<void>;
  renderPrompt?: (task: TaskSpec) => string;
  heartbeatIntervalMs?: number;
  staleThresholdMs?: number;
}

export type TaskRunResult = { ok: true; status: TaskStatus } | { ok: false; error: string };

export class TaskRunCoordinator {
  private readonly activeRuns = new Map<string, RunSession>();

  constructor(private readonly deps: TaskRunCoordinatorDeps) {}

  getActiveRun(taskId: string): RunSession | undefined {
    return this.activeRuns.get(taskId);
  }

  async run(task: TaskSpec): Promise<TaskRunResult> {
    const { provider, model, id } = task.frontmatter;
    if (!provider) return { ok: false, error: 'Work order is missing provider' };
    if (!model) return { ok: false, error: 'Work order is missing model' };
    if (this.activeRuns.has(id)) return { ok: false, error: 'This work order is already running.' };
    if (!this.deps.isProviderEnabled(provider)) return { ok: false, error: `Provider ${provider} is not enabled` };
    if (!this.deps.ownsModel(provider, model)) return { ok: false, error: `Model ${model} is not available for provider ${provider}` };

    const prompt = (this.deps.renderPrompt ?? renderTaskPrompt)(task);
    const handle = await this.deps.executionSurface.startTaskRun(task, { prompt });
    if (!handle.runId) {
      const terminal = await handle.terminal;
      return { ok: false, error: terminal.error ?? 'Run failed.' };
    }

    const session = new RunSession({
      task,
      runId: handle.runId,
      conversationId: handle.conversationId,
      sidepanelTabId: handle.sidepanelTabId,
      stream: handle.stream,
      events: this.deps.events,
      now: this.deps.now,
      writeStatus: this.deps.writeTaskStatus,
      flushLedger: (entries) => this.deps.flushLedger(task, entries),
      writeHandoff: this.deps.writeHandoff,
      heartbeatIntervalMs: this.deps.heartbeatIntervalMs,
      staleThresholdMs: this.deps.staleThresholdMs,
    });
    this.activeRuns.set(id, session);
    try {
      const result: RunSessionResult = await session.run();
      // Also resolve the surface's own terminal promise (it's awaited by adapters internally).
      await handle.terminal.catch(() => undefined);
      if (result.ok) return { ok: true, status: result.status };
      return { ok: false, error: result.error };
    } finally {
      this.activeRuns.delete(id);
    }
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=TaskRunCoordinator
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/execution/TaskRunCoordinator.ts tests/unit/features/tasks/execution/TaskRunCoordinator.test.ts
git commit -m "refactor(tasks): TaskRunCoordinator delegates lifecycle to RunSession"
```

---

### Task 10: TaskPromptRenderer Protocol + Prior Attempts

**Files:**
- Modify: `src/features/tasks/prompt/TaskPromptRenderer.ts`
- Modify: `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts`:

```typescript
describe('renderTaskPrompt — Protocol + Prior Attempts', () => {
  it('includes the Protocol section with all three blocks', () => {
    const prompt = renderTaskPrompt(task);
    expect(prompt).toContain('## Protocol');
    expect(prompt).toContain('<claudian_progress>');
    expect(prompt).toContain('<claudian_needs_input>');
    expect(prompt).toContain('<claudian_needs_approval>');
  });

  it('omits Prior Attempts on first run (empty ledger)', () => {
    const empty = { ...task, sections: { ...task.sections, ledger: '' } };
    expect(renderTaskPrompt(empty)).not.toContain('## Prior Attempts');
  });

  it('includes Prior Attempts on rerun with prior ledger entries', () => {
    const ledger = [
      '- 2026-06-04T10:00:00Z [running] Run started (attempt 1)',
      '- 2026-06-04T10:01:00Z [running] tool: Edit src/foo.ts',
      '- 2026-06-04T10:02:00Z [needs_fix] Tests still failing',
    ].join('\n');
    const t = { ...task, sections: { ...task.sections, ledger } };
    const prompt = renderTaskPrompt(t);
    expect(prompt).toContain('## Prior Attempts');
    expect(prompt).toContain('tool: Edit src/foo.ts');
    expect(prompt).toContain('Tests still failing');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npm test -- --selectProjects unit --testPathPatterns=TaskPromptRenderer
```

Expected: FAIL — sections not present.

- [ ] **Step 3: Inject the new sections**

Edit `src/features/tasks/prompt/TaskPromptRenderer.ts`. After the existing `## Docs Sync` block and before `## Context`, add a `${protocol}` interpolation, plus a `${priorAttempts}` block before `## Required Structured Handoff`. Replace the `return` template and add helper functions:

```typescript
const protocol = `

## Protocol
While running, you may emit these inline blocks. Use them whenever the situation calls for them; the harness watches the stream and reacts.

- <claudian_progress>step: …; done: N/M; note: …</claudian_progress>
  Optional milestone updates. Emit at natural boundaries; do not flood.

- <claudian_needs_input>question: …; why: …; default: …</claudian_needs_input>
  When you genuinely need information you cannot derive. End your turn after this block. The run pauses; you will be resumed with the user's reply.

- <claudian_needs_approval>action: …; risk: …; reversible: true|false</claudian_needs_approval>
  Before destructive or irreversible operations. End your turn after this block. The run pauses; you will be resumed only if the user approves.

End the entire run with one <claudian_handoff> block as specified below.`;

const priorAttempts = renderPriorAttempts(task.sections.ledger);

return `${task.frontmatter.title}

You are executing a Claudian work order. Complete only the task described below and respect all constraints.

## Work Order
Work order path: ${task.path}
Title: ${task.frontmatter.title}
Task ID: ${task.frontmatter.id}
Provider/model: ${provider} / ${model}

## Objective
${task.sections.objective}

## Acceptance Criteria
${task.sections.acceptanceCriteria}

## Progress Tracking
As you complete each acceptance criterion above, edit this work order note (${task.path}) and change the matching \`- [ ]\` checkbox to \`- [x]\`. Keep the checklist accurate as you make progress. Do not edit the Run Ledger or Result / Handoff sections — Claudian owns those.

## Docs Sync
While executing, update the related docs referenced from Objective/Context (plan, spec, ADR, issue, PRD) so progress is visible to humans reading those docs — do not let the work order be the only place that reflects current state. Before completing the work order, verify all related docs are updated to reflect the final state and any decisions made during the run.${protocol}

## Context
${task.sections.context}

## Constraints
${task.sections.constraints}${dor}${dod}${reworkNotes}${priorAttempts}

## Required Structured Handoff
At the end of your final response, include exactly one strict handoff block in this format:

<claudian_handoff>
summary: Briefly describe what changed.
verification: List the checks you ran and their results.
risks: List remaining risks or write "None".
next_action: State the next concrete action for the human or follow-up agent.
</claudian_handoff>

The handoff fields are required. Do not omit summary, verification, risks, or next_action.`;
```

Add `renderPriorAttempts` helper at module scope:

```typescript
function renderPriorAttempts(ledger: string): string {
  if (!ledger) return '';
  const lines = ledger.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return '';
  // Only show on reruns: a "rerun" is detected by a prior [review] or [needs_fix] entry.
  const isRerun = lines.some((l) => /\[(review|needs_fix)\]/.test(l));
  if (!isRerun) return '';
  const tail = lines.slice(-20);
  return `\n\n## Prior Attempts\nLedger from previous attempts (most recent at the bottom):\n${tail.join('\n')}`;
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=TaskPromptRenderer
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/prompt/TaskPromptRenderer.ts tests/unit/features/tasks/prompt/TaskPromptRenderer.test.ts
git commit -m "feat(tasks): inject Protocol section and Prior Attempts into run prompt"
```

---

### Task 11: Claude stream adapter

**Files:**
- Create: `src/providers/claude/runtime/ClaudeStreamAdapter.ts`
- Create: `tests/unit/providers/claude/runtime/ClaudeStreamAdapter.test.ts`

- [ ] **Step 1: Inspect existing Claude runtime stream shape**

Read `src/providers/claude/runtime/` for the existing types that wrap Claude SDK stream events. Look in particular for the type that bridges `ChatRuntime.query` chunks; the adapter consumes those same chunks. Confirm naming (e.g. `ClaudeStreamChunk`, `ClaudeToolUseChunk`) before writing tests.

- [ ] **Step 2: Write the failing adapter test**

Create `tests/unit/providers/claude/runtime/ClaudeStreamAdapter.test.ts`. Build a small fake of the chat-tab runtime emission API the adapter listens to (mirror the actual chunk shape from Step 1):

```typescript
import { ClaudeStreamAdapter } from '../../../../../src/providers/claude/runtime/ClaudeStreamAdapter';
import type { StreamHandlers } from '../../../../../src/features/tasks/execution/ProviderStreamAdapter';

class FakeTab {
  private listeners: Array<(chunk: unknown) => void> = [];
  // Mirror the real method name used by the existing chat runtime.
  onChunk(cb: (chunk: unknown) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((l) => l !== cb); };
  }
  emit(chunk: unknown): void { for (const l of this.listeners) l(chunk); }
  async sendFollowUp(_content: string): Promise<void> { /* spy in tests */ }
  cancel(): void { /* spy in tests */ }
}

function captureHandlers() {
  const calls: Array<[string, unknown]> = [];
  const handlers: StreamHandlers = {
    onText: (c) => calls.push(['text', c]),
    onToolUse: (t) => calls.push(['tool', t]),
    onToolResult: (n, ok) => calls.push(['result', { name: n, ok }]),
    onError: (e) => calls.push(['error', e]),
    onEnd: (p) => calls.push(['end', p]),
  };
  return { calls, handlers };
}

describe('ClaudeStreamAdapter', () => {
  it('maps text deltas to onText', () => {
    const tab = new FakeTab();
    const adapter = new ClaudeStreamAdapter(tab as unknown as Parameters<typeof ClaudeStreamAdapter['prototype']['constructor']>[0]);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);
    tab.emit({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } });
    expect(calls).toEqual([['text', 'hello']]);
  });

  it('maps tool_use start to onToolUse with primaryArg', () => {
    const tab = new FakeTab();
    const adapter = new ClaudeStreamAdapter(tab as unknown as Parameters<typeof ClaudeStreamAdapter['prototype']['constructor']>[0]);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);
    tab.emit({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'Edit', input: { file_path: 'src/foo.ts' } } });
    expect(calls).toEqual([['tool', { name: 'Edit', primaryArg: 'src/foo.ts' }]]);
  });

  it('maps Bash tool to first 60 chars of command', () => {
    const tab = new FakeTab();
    const adapter = new ClaudeStreamAdapter(tab as unknown as Parameters<typeof ClaudeStreamAdapter['prototype']['constructor']>[0]);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);
    tab.emit({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash', input: { command: 'npm test -- --selectProjects unit --testPathPatterns=TaskRun' } } });
    expect(calls[0]).toEqual(['tool', { name: 'Bash', primaryArg: 'npm test -- --selectProjects unit --testPathPatterns=TaskRun' }]);
  });

  it('maps message_stop to onEnd with completed status', () => {
    const tab = new FakeTab();
    const adapter = new ClaudeStreamAdapter(tab as unknown as Parameters<typeof ClaudeStreamAdapter['prototype']['constructor']>[0]);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);
    tab.emit({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'final ' } });
    tab.emit({ type: 'message_stop' });
    expect(calls[calls.length - 1]).toEqual(['end', { status: 'completed', finalAssistantContent: 'final ' }]);
  });

  it('drops events after onEnd', () => {
    const tab = new FakeTab();
    const adapter = new ClaudeStreamAdapter(tab as unknown as Parameters<typeof ClaudeStreamAdapter['prototype']['constructor']>[0]);
    const { calls, handlers } = captureHandlers();
    adapter.subscribe(handlers);
    tab.emit({ type: 'message_stop' });
    tab.emit({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'late' } });
    expect(calls.filter(([k]) => k === 'text')).toEqual([]);
  });
});
```

- [ ] **Step 3: Implement ClaudeStreamAdapter**

Create `src/providers/claude/runtime/ClaudeStreamAdapter.ts`:

```typescript
import type {
  ProviderStreamAdapter,
  StreamHandlers,
  StreamToolUse,
} from '../../../features/tasks/execution/ProviderStreamAdapter';

// Surface contract from the chat tab the adapter listens to. Provide whatever
// the real chat-tab API exposes for stream subscription, follow-up sending, and
// cancellation. The shape below is the minimum the adapter requires; align the
// real wiring in ClaudianView.startTaskRunInFreshTab.
export interface ClaudeStreamTabHandle {
  onChunk(cb: (chunk: unknown) => void): () => void;
  sendFollowUp(content: string): Promise<void>;
  cancel(): void;
}

export class ClaudeStreamAdapter implements ProviderStreamAdapter {
  private handlers: StreamHandlers | null = null;
  private unsubscribe: (() => void) | null = null;
  private finished = false;
  private finalAssistantContent = '';

  constructor(private readonly tab: ClaudeStreamTabHandle) {}

  subscribe(handlers: StreamHandlers): () => void {
    this.handlers = handlers;
    this.unsubscribe?.();
    this.unsubscribe = this.tab.onChunk((chunk) => this.handle(chunk));
    return () => {
      if (this.handlers === handlers) {
        this.handlers = null;
        this.unsubscribe?.();
        this.unsubscribe = null;
      }
    };
  }

  async sendFollowUp(content: string): Promise<void> {
    if (this.finished) throw new Error('conversation closed');
    await this.tab.sendFollowUp(content);
  }

  cancel(): void {
    if (this.finished) return;
    this.tab.cancel();
  }

  private handle(chunk: unknown): void {
    if (this.finished || this.handlers === null) return;
    const c = chunk as ClaudeChunk;
    if (c.type === 'content_block_delta' && c.delta?.type === 'text_delta' && typeof c.delta.text === 'string') {
      this.finalAssistantContent += c.delta.text;
      this.handlers.onText(c.delta.text);
      return;
    }
    if (c.type === 'content_block_start' && c.content_block?.type === 'tool_use') {
      const tool: StreamToolUse = {
        name: c.content_block.name ?? 'tool',
        primaryArg: extractPrimaryArg(c.content_block.name, c.content_block.input),
      };
      this.handlers.onToolUse(tool);
      return;
    }
    if (c.type === 'content_block_start' && c.content_block?.type === 'tool_result') {
      this.handlers.onToolResult(c.content_block.tool_name ?? 'tool', !c.content_block.is_error);
      return;
    }
    if (c.type === 'error') {
      this.finished = true;
      this.handlers.onError(typeof c.error === 'string' ? c.error : 'Claude SDK error');
      this.handlers.onEnd({ status: 'failed', finalAssistantContent: this.finalAssistantContent, error: 'Claude SDK error' });
      return;
    }
    if (c.type === 'message_stop') {
      this.finished = true;
      this.handlers.onEnd({ status: 'completed', finalAssistantContent: this.finalAssistantContent });
    }
  }
}

interface ClaudeChunk {
  type: string;
  delta?: { type?: string; text?: string };
  content_block?: { type?: string; name?: string; input?: Record<string, unknown>; tool_name?: string; is_error?: boolean };
  error?: unknown;
}

function extractPrimaryArg(toolName: string | undefined, input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Read' || toolName === 'apply_patch') {
    return typeof input.file_path === 'string' ? input.file_path : null;
  }
  if (toolName === 'Bash' || toolName === 'shell' || toolName === 'exec') {
    return typeof input.command === 'string' ? input.command.slice(0, 60) : null;
  }
  if (toolName === 'Grep' || toolName === 'Glob') {
    return typeof input.pattern === 'string' ? input.pattern : null;
  }
  return null;
}
```

- [ ] **Step 4: Wire Claude adapter into the registry**

Find the Claude provider's bootstrap (somewhere under `src/providers/claude/` — typically a `register…` function). Register the factory once at module init:

```typescript
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import { ClaudeStreamAdapter } from './runtime/ClaudeStreamAdapter';

ProviderWorkspaceRegistry.registerStreamAdapterFactory('claude', {
  createForTab(tab) {
    return new ClaudeStreamAdapter(tab as never);
  },
});
```

(Use the actual provider id constant the existing code uses, not the string literal, if one is exported.)

For the real chat-tab API: replace the `tab as never` with the proper accessor that exposes the SDK stream emitter on the chat tab. The minimum API the adapter needs is the `ClaudeStreamTabHandle` interface defined above; if such accessors don't exist yet, add them on the tab controller in a small `provideStreamHandle()` method.

- [ ] **Step 5: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=ClaudeStreamAdapter
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/providers/claude/runtime/ClaudeStreamAdapter.ts tests/unit/providers/claude/runtime/ClaudeStreamAdapter.test.ts src/providers/claude
git commit -m "feat(claude): stream adapter for work-order live ledger"
```

---

### Task 12: Codex stream adapter

**Files:**
- Create: `src/providers/codex/runtime/CodexStreamAdapter.ts`
- Create: `tests/unit/providers/codex/runtime/CodexStreamAdapter.test.ts`

- [ ] **Step 1: Inspect Codex normalization output**

Read `src/providers/codex/runtime/codexNormalization` (file path may differ — look under `src/providers/codex/runtime/`) to confirm the event shape produced for `assistantMessageDelta`, `toolUseStart`, `toolUseEnd`, and `runCompleted`. The adapter consumes those normalized events.

- [ ] **Step 2: Write the failing adapter test**

Create `tests/unit/providers/codex/runtime/CodexStreamAdapter.test.ts`. Mirror the shape produced by Step 1 inputs. The test should drive: text delta, tool start, tool end, run completed, run failed. Use the same fake-tab pattern as Task 11 but with Codex normalized event shapes.

- [ ] **Step 3: Implement `CodexStreamAdapter`**

Create `src/providers/codex/runtime/CodexStreamAdapter.ts` following the same `ClaudeStreamAdapter` pattern: own a `CodexStreamTabHandle` interface, decode events in `handle()`, map to `StreamHandlers`. Extract `primaryArg` from Codex tool inputs (`exec` → first 60 chars of command; `apply_patch` → first file path).

- [ ] **Step 4: Register the factory**

Find the Codex provider bootstrap and register:

```typescript
ProviderWorkspaceRegistry.registerStreamAdapterFactory('codex', {
  createForTab(tab) { return new CodexStreamAdapter(tab as never); },
});
```

- [ ] **Step 5: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=CodexStreamAdapter
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/providers/codex tests/unit/providers/codex
git commit -m "feat(codex): stream adapter for work-order live ledger"
```

---

### Task 13: Opencode stream adapter

**Files:**
- Create: `src/providers/opencode/runtime/OpencodeStreamAdapter.ts`
- Create: `tests/unit/providers/opencode/runtime/OpencodeStreamAdapter.test.ts`

- [ ] **Step 1: Inspect ACP update normalizer**

Read `src/providers/acp/` for the existing ACP `session/update` normalizer. The adapter routes already-normalized updates: `agentMessageChunk`, `toolCall`, `toolCallUpdate`.

- [ ] **Step 2: Write failing test + implementation**

Mirror Task 11/12 — fake tab emits normalized ACP updates; adapter maps to `StreamHandlers`. Map `toolCall.rawInput` first scalar to `primaryArg` (file path / command / pattern as per the spec table).

- [ ] **Step 3: Register the factory in the Opencode bootstrap**

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=OpencodeStreamAdapter
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/providers/opencode tests/unit/providers/opencode
git commit -m "feat(opencode): stream adapter for work-order live ledger"
```

---

### Task 14: Cursor stream adapter

**Files:**
- Create: `src/providers/cursor/runtime/CursorStreamAdapter.ts`
- Create: `tests/unit/providers/cursor/runtime/CursorStreamAdapter.test.ts`

- [ ] **Step 1: Inspect cursorStreamMapper**

Read `src/providers/cursor/runtime/cursorStreamMapper` to confirm the NDJSON event shapes (`assistant`, `tool_use`, `tool_result`, `result`) it produces.

- [ ] **Step 2: Write failing test + implementation**

Same pattern. Note: `result` events with `subtype: 'success' | 'error'` map to `onEnd`. Otherwise mirror Claude.

- [ ] **Step 3: Register the factory in the Cursor bootstrap**

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test -- --selectProjects unit --testPathPatterns=CursorStreamAdapter
npm run typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/providers/cursor tests/unit/providers/cursor
git commit -m "feat(cursor): stream adapter for work-order live ledger"
```

---

### Task 15: AgentBoardRenderer — DOM diffing + live strip + reply surface

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Modify: `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`
- Modify: `src/style/tasks/_agent-board.css` (or equivalent CSS source file)

- [ ] **Step 1: Add failing tests for the new render paths**

In `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`, append (after existing tests):

```typescript
describe('AgentBoardRenderer — live strip + patches', () => {
  it('renderInitial paints a live strip placeholder for running tasks', () => {
    const renderer = new AgentBoardRenderer();
    const container = document.createElement('div');
    renderer.renderInitial(container, {
      layout: { lanes: [{ status: 'running', title: 'Running', tasks: [makeTask({ status: 'running', started: '2026-06-04T08:00:00Z' })], definitionOfReady: [], definitionOfDone: [] }], errors: [] },
      invalidNotes: [],
      slots: { used: 0, max: 4 },
    } as never, makeCallbacks());
    expect(container.querySelector('.claudian-agent-board-card-live-strip')).toBeTruthy();
  });

  it('patchLiveStrip updates last ledger line without rebuilding the card', () => {
    const renderer = new AgentBoardRenderer();
    const container = document.createElement('div');
    renderer.renderInitial(container, layoutWith({ status: 'running' }), makeCallbacks());
    const card = container.querySelector('.claudian-agent-board-card')!;
    renderer.patchLiveStrip('task-1', { lastLedger: 'tool: Edit src/foo.ts', elapsedMs: 12_000, attemptNumber: 1, heartbeatAgeMs: 2_000 });
    const ledgerEl = card.querySelector('.claudian-agent-board-card-live-strip--ledger');
    expect(ledgerEl?.textContent).toBe('tool: Edit src/foo.ts');
    // Same DOM node, not re-created.
    const cardAfter = container.querySelector('.claudian-agent-board-card')!;
    expect(cardAfter).toBe(card);
  });

  it('paused state shows the reply box for needs_input', () => {
    const renderer = new AgentBoardRenderer();
    const container = document.createElement('div');
    renderer.renderInitial(container, layoutWith({ status: 'needs_input', pause_reason: 'which env?' }), makeCallbacks());
    renderer.patchCard('task-1', taskWith({ status: 'needs_input', pause_reason: 'which env?' }), { question: 'which env?', defaultValue: '.env.local', runId: 'r1' });
    expect(container.querySelector('.claudian-agent-board-card-reply')).toBeTruthy();
    const field = container.querySelector('.claudian-agent-board-card-reply--field') as HTMLInputElement | null;
    expect(field?.value).toBe('.env.local');
  });
});

// Add helpers `makeTask`, `makeCallbacks`, `layoutWith`, `taskWith` at file top
// matching the test's needs; reuse patterns already present in the file.
```

- [ ] **Step 2: Run failing test**

```bash
npm test -- --selectProjects unit --testPathPatterns=AgentBoardRenderer
```

Expected: FAIL — `renderInitial`, `patchCard`, `patchLiveStrip` not defined.

- [ ] **Step 3: Refactor `AgentBoardRenderer`**

Edit `src/features/tasks/ui/AgentBoardRenderer.ts`. Add a card-ref map and three render entry points.

Add at the top of the class:

```typescript
private cardRefs = new Map<string, {
  card: HTMLElement;
  statusBadge: HTMLElement;
  liveStripMeta: HTMLElement;
  liveStripLedger: HTMLElement;
  actions: HTMLElement;
  reply: HTMLElement | null;
}>();
```

Rename the existing `render` method to `renderInitial`. Inside `renderCard`, after building each card, record the refs:

```typescript
this.cardRefs.set(task.frontmatter.id, {
  card,
  statusBadge,
  liveStripMeta,
  liveStripLedger,
  actions,
  reply: null,
});
```

Build the live strip inside `renderCard` for runnable / paused statuses:

```typescript
const liveStrip = card.createDiv({ cls: 'claudian-agent-board-card-live-strip' });
const liveStripMeta = liveStrip.createDiv({ cls: 'claudian-agent-board-card-live-strip--meta' });
const liveStripLedger = liveStrip.createDiv({ cls: 'claudian-agent-board-card-live-strip--ledger' });
if (status === 'running' || status === 'needs_input' || status === 'needs_approval') {
  liveStripMeta.setText(`● ${status} · attempt ${task.frontmatter.attempts}`);
  const lastLedgerLine = lastLineOf(task.sections.ledger);
  liveStripLedger.setText(lastLedgerLine ?? 'starting…');
}
```

Add helper `lastLineOf(ledger: string): string | null` at module scope:

```typescript
function lastLineOf(ledger: string): string | null {
  const lines = ledger.split('\n').filter((l) => l.trim().length > 0);
  return lines.length === 0 ? null : lines[lines.length - 1];
}
```

Add `patchCard` + `patchLiveStrip` methods to the class:

```typescript
patchCard(taskId: string, task: TaskSpec, pause?: { question?: string; action?: string; risk?: string; defaultValue?: string; reversible?: boolean; runId: string } | null): void {
  const refs = this.cardRefs.get(taskId);
  if (!refs) return;
  refs.statusBadge.setText(DEFAULT_LANE_TITLES[task.frontmatter.status]);
  refs.statusBadge.className = `claudian-agent-board-status-badge claudian-agent-board-status-badge--${task.frontmatter.status}`;
  refs.card.className = `claudian-agent-board-card claudian-agent-board-card--${task.frontmatter.status}`;
  refs.actions.empty();
  // Re-render action buttons matching the new status.
  this.renderActionsFor(refs.actions, task);
  // Tear down or rebuild the reply surface.
  if (refs.reply) { refs.reply.remove(); refs.reply = null; }
  if (pause && (task.frontmatter.status === 'needs_input' || task.frontmatter.status === 'needs_approval')) {
    refs.reply = this.renderReplySurface(refs.card, task, pause);
  }
}

patchLiveStrip(taskId: string, payload: {
  lastLedger?: string;
  elapsedMs: number;
  attemptNumber: number;
  heartbeatAgeMs: number;
}): void {
  const refs = this.cardRefs.get(taskId);
  if (!refs) return;
  const elapsed = formatElapsed(payload.elapsedMs);
  const dotColor = staleTier(payload.heartbeatAgeMs);
  refs.liveStripMeta.className = `claudian-agent-board-card-live-strip--meta claudian-stale-${dotColor}`;
  refs.liveStripMeta.setText(`● ${elapsed} · attempt ${payload.attemptNumber}`);
  if (payload.lastLedger !== undefined) {
    refs.liveStripLedger.setText(payload.lastLedger);
  }
}
```

Add `renderReplySurface` (private), `formatElapsed`, `staleTier` helpers at the module / class. `staleTier`: `< 60000` → `green`, `< 300000` → `amber`, else `red`. `formatElapsed`: `Nm Ss`.

Move action-button building out of `renderCard` into `renderActionsFor(actions: HTMLElement, task: TaskSpec)` so it can be reused by `patchCard`.

- [ ] **Step 4: Add CSS**

Edit `src/style/tasks/_agent-board.css` (or the appropriate Agent Board CSS source). Append:

```css
.claudian-agent-board-card-live-strip { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.8rem; opacity: 0.9; margin-top: 0.4rem; }
.claudian-agent-board-card-live-strip--meta { font-variant-numeric: tabular-nums; }
.claudian-agent-board-card-live-strip--ledger { color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.claudian-stale-green::first-letter { color: var(--color-green); }
.claudian-stale-amber::first-letter { color: var(--color-orange); }
.claudian-stale-red::first-letter { color: var(--color-red); }
.claudian-agent-board-card--needs_input, .claudian-agent-board-card--needs_approval { border-left: 3px solid var(--color-orange); }
.claudian-agent-board-card-reply { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--background-modifier-border); }
.claudian-agent-board-card-reply--field { width: 100%; }
.claudian-agent-board-card-reply--actions { display: flex; gap: 0.4rem; }
@keyframes claudian-pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.claudian-agent-board-card--running .claudian-agent-board-card-live-strip--meta::first-letter,
.claudian-agent-board-card--needs_input .claudian-agent-board-card-live-strip--meta::first-letter,
.claudian-agent-board-card--needs_approval .claudian-agent-board-card-live-strip--meta::first-letter {
  animation: claudian-pulse-dot 1.2s ease-in-out infinite;
}
```

- [ ] **Step 5: Run tests + typecheck + build**

```bash
npm test -- --selectProjects unit --testPathPatterns=AgentBoardRenderer
npm run typecheck
npm run build
```

Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/ui/AgentBoardRenderer.ts tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts src/style/tasks
git commit -m "feat(agent-board): live strip + paused reply + per-card patching"
```

---

### Task 16: AgentBoardView event wiring + crash recovery

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [ ] **Step 1: Subscribe to the new events and route to renderer**

Edit `src/features/tasks/ui/AgentBoardView.ts`. In `onOpen`, after existing event registrations, add:

```typescript
this.register(this.plugin.events.on('task:status-changed', (p) => this.onStatusChanged(p)));
this.register(this.plugin.events.on('task:attempt-started', (p) => this.patchCard(p.taskId)));
this.register(this.plugin.events.on('task:ledger-appended', (p) => this.patchLiveStrip(p.taskId)));
this.register(this.plugin.events.on('task:heartbeat', (p) => this.patchLiveStrip(p.taskId)));
this.register(this.plugin.events.on('task:needs-input', (p) => this.onPauseRequested(p, 'needs_input')));
this.register(this.plugin.events.on('task:needs-approval', (p) => this.onPauseRequested(p, 'needs_approval')));
this.register(this.plugin.events.on('task:resumed', (p) => this.patchCard(p.taskId)));
```

Add a per-second elapsed-timer interval inside `onOpen`:

```typescript
this.elapsedTimer = window.setInterval(() => {
  for (const task of this.model.tasks) {
    if (task.frontmatter.status === 'running' || task.frontmatter.status === 'needs_input' || task.frontmatter.status === 'needs_approval') {
      this.patchLiveStrip(task.frontmatter.id);
    }
  }
}, 1000);
this.register(() => window.clearInterval(this.elapsedTimer ?? 0));
```

Add field declarations on the class (above the constructor):

```typescript
private elapsedTimer: number | null = null;
private pauseState = new Map<string, {
  question?: string;
  action?: string;
  risk?: string;
  defaultValue?: string;
  reversible?: boolean;
  runId: string;
}>();
```

- [ ] **Step 2: Implement the patch helpers**

Add private methods:

```typescript
private onStatusChanged(p: { taskId: string; status: TaskStatus }): void {
  if (p.status !== 'needs_input' && p.status !== 'needs_approval') this.pauseState.delete(p.taskId);
  this.patchCard(p.taskId);
}

private onPauseRequested(
  p: { taskId: string; runId: string; question?: string; action?: string; risk?: string; default?: string; reversible?: boolean },
  kind: 'needs_input' | 'needs_approval',
): void {
  this.pauseState.set(p.taskId, {
    question: kind === 'needs_input' ? p.question : undefined,
    action: kind === 'needs_approval' ? p.action : undefined,
    risk: p.risk,
    defaultValue: p.default,
    reversible: p.reversible,
    runId: p.runId,
  });
  this.patchCard(p.taskId);
}

private patchCard(taskId: string): void {
  const task = this.model.tasks.find((t) => t.frontmatter.id === taskId);
  if (!task) return;
  const pause = this.pauseState.get(taskId) ?? null;
  this.renderer.patchCard(taskId, task, pause);
}

private patchLiveStrip(taskId: string): void {
  const task = this.model.tasks.find((t) => t.frontmatter.id === taskId);
  if (!task) return;
  const startedAt = task.frontmatter.started ? Date.parse(task.frontmatter.started) : Date.now();
  const heartbeatAt = task.frontmatter.heartbeat ? Date.parse(task.frontmatter.heartbeat) : Date.now();
  const lastLedger = task.sections.ledger.split('\n').filter((l) => l.trim().length > 0).pop();
  this.renderer.patchLiveStrip(taskId, {
    lastLedger,
    elapsedMs: Date.now() - startedAt,
    attemptNumber: task.frontmatter.attempts,
    heartbeatAgeMs: Date.now() - heartbeatAt,
  });
}
```

Replace the existing `render()` call inside the event handlers with the appropriate `patchCard` / `patchLiveStrip` calls. Keep the full `render()` for `task:board-config-changed` (the existing `refresh` path).

- [ ] **Step 3: Route reply + cancel + approve/reject through the active RunSession**

When the user clicks Send / Approve / Reject on the card, the callback (added on the renderer's reply surface) should call back into `AgentBoardView`. Add:

```typescript
private async onReply(taskId: string, content: string): Promise<void> {
  const session = this.coordinator?.getActiveRun(taskId);
  if (!session) return;
  await session.resume({ kind: 'reply', content });
}

private async onApprove(taskId: string): Promise<void> {
  const session = this.coordinator?.getActiveRun(taskId);
  if (!session) return;
  await session.resume({ kind: 'approve' });
}

private async onReject(taskId: string, reason: string): Promise<void> {
  const session = this.coordinator?.getActiveRun(taskId);
  if (!session) return;
  await session.resume({ kind: 'reject', reason });
}
```

Keep the existing per-run `TaskRunCoordinator` construction inside `runTask`, but hoist the instance to a field so it is reachable from the reply handlers. Refactor: change `private async runTask(task: TaskSpec)` to hold `this.coordinator = new TaskRunCoordinator({ ... })` once (lazy on first run, kept across runs).

Wire the renderer callbacks (extend `AgentBoardRenderCallbacks` with `onReply`, `onApprove`, `onReject`, `onCancelPaused`) and pass these methods in the `renderInitial` call.

- [ ] **Step 4: Crash recovery scan**

Add to the end of `onOpen`, after the initial `await this.refresh()`:

```typescript
await this.recoverOrphanedRuns();
```

Implement:

```typescript
private async recoverOrphanedRuns(): Promise<void> {
  const now = new Date().toISOString();
  for (const task of this.model.tasks) {
    const s = task.frontmatter.status;
    if (s !== 'running' && s !== 'needs_input' && s !== 'needs_approval') continue;
    if (this.coordinator?.getActiveRun(task.frontmatter.id)) continue;
    await this.applyNoteChange(task.path, (content) =>
      this.noteStore.appendLedger(content, { timestamp: now, status: 'failed', message: 'orphaned by plugin reload' }),
    );
    await this.applyNoteChange(task.path, (content) =>
      this.noteStore.writeStatus(content, { status: 'failed', timestamp: now }),
    );
    this.plugin.events.emit('task:status-changed', { taskId: task.frontmatter.id, path: task.path, status: 'failed' });
  }
  await this.refresh();
}
```

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck
npm run build
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat(agent-board): wire live events, reply routing, and crash recovery"
```

---

### Task 17: Integration suite

**Files:**
- Create: `tests/integration/features/tasks/taskRun.happyPath.test.ts`
- Create: `tests/integration/features/tasks/taskRun.needsInput.test.ts`
- Create: `tests/integration/features/tasks/taskRun.needsApproval.test.ts`
- Create: `tests/integration/features/tasks/taskRun.needsHandoff.test.ts`
- Create: `tests/integration/features/tasks/taskRun.heartbeatLost.test.ts`
- Create: `tests/integration/features/tasks/taskRun.crashRecovery.test.ts`
- Create: `tests/integration/features/tasks/taskRun.cancelDuringPause.test.ts`
- Create: `tests/integration/features/tasks/taskRun.parserMalformed.test.ts`

- [ ] **Step 1: Happy path**

Create `tests/integration/features/tasks/taskRun.happyPath.test.ts`. Use the `SyntheticStreamAdapter`, a real `RunSession`, and a `Map<string, string>`-backed note store stub. Drive: text → progress block → tool use → text → handoff block → onEnd(completed). Assert: status sequence `['running', 'review']`; ledger contains lines for `Run started`, `progress`, `tool`, `Handoff written.`; handoff markdown written.

- [ ] **Step 2: needs_input**

Same shape. Emit `<claudian_needs_input>question: which env?\n</claudian_needs_input>`; await pause; call `session.resume({ kind: 'reply', content: '.env.local' })`; emit handoff; assert `adapter.followUps == ['.env.local']` and status sequence ends at `review`.

- [ ] **Step 3: needs_approval (approve + reject branches in one file)**

Two tests in this file: approve path → `running` then `review`; reject path → `canceled` with the reason in the ledger.

- [ ] **Step 4: needs_handoff**

Emit text without a handoff block; `onEnd({ status: 'completed', finalAssistantContent: 'did stuff' })`. Assert status `needs_handoff` and ledger has `[needs_handoff]` entry.

- [ ] **Step 5: heartbeat lost**

Use `jest.useFakeTimers()`. Construct `RunSession` with `heartbeatIntervalMs: 500`, `staleThresholdMs: 2000`. Advance time past threshold without emitting events; assert final status `failed` and ledger message includes `heartbeat lost`.

- [ ] **Step 6: crash recovery**

Construct an `AgentBoardView` test harness (or call `recoverOrphanedRuns` directly via a small test-only export) with a synthetic on-disk model containing one work order with status `running` and no live session. Assert one ledger entry `orphaned by plugin reload` and final status `failed`.

- [ ] **Step 7: cancel during pause**

Emit `<claudian_needs_input>…</claudian_needs_input>`; before resume, call `session.cancel()`. Assert status `canceled` and ledger reason `stopped by user`.

- [ ] **Step 8: parser malformed**

Emit `<claudian_needs_input>why: no question</claudian_needs_input>`. Assert `task:parser-warning` fired, ledger contains `(parser) needs_input missing required field: question`, run continues, completes normally with valid handoff at end.

- [ ] **Step 9: Run integration suite**

```bash
npm test -- --selectProjects integration --testPathPatterns=taskRun
npm run typecheck
```

Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add tests/integration/features/tasks
git commit -m "test(tasks): integration suite for live run lifecycle"
```

---

### Task 18: Manual smoke + Definition of Done

- [ ] **Step 1: Run the full local gate**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: exit 0.

- [ ] **Step 2: Per-provider manual smoke checklist**

For each of `claude`, `codex`, `opencode`, `cursor`:

1. Build and load the plugin into the test vault.
2. Create a small work order whose Objective asks the agent to (a) emit one `<claudian_progress>`, (b) ask one `<claudian_needs_input>` mid-run, (c) request one `<claudian_needs_approval>`, (d) finish with a valid `<claudian_handoff>`.
3. Click Run from the Agent Board.
4. Without opening the run tab, confirm on the card:
   - Live strip elapsed ticks every second.
   - "tool:" line appears for at least one tool call.
   - "progress:" line appears for the progress block.
   - Inline reply box appears for `needs_input`; submit a reply; run resumes.
   - Approve/Reject buttons appear for `needs_approval`; approve; run resumes.
   - Final state lands in `review` with handoff rendered in the work-order note.
5. Attach the resulting work-order ledger to the implementation PR.

- [ ] **Step 3: Update the spec status**

Edit `docs/superpowers/specs/2026-06-04-work-order-execution-design.md` frontmatter: change `status: draft` to `status: shipped`. Commit:

```bash
git add docs/superpowers/specs/2026-06-04-work-order-execution-design.md
git commit -m "docs(specs): mark work-order execution design as shipped"
```

- [ ] **Step 4: Open the PR**

Final commit message format for the umbrella PR description: include the goals, manual smoke results per provider, and link to the spec.

---

## Self-Review Summary

After writing this plan, a fresh-eyes pass revealed:

1. **Spec coverage:** Every numbered section of the design maps to a task. State machine → Task 1; frontmatter store → Task 2; parser → Task 3; ledger writer → Task 4; adapter interface + helper → Task 5; events → Task 6; RunSession → Task 7; surface contract → Task 8; coordinator refactor → Task 9; prompt → Task 10; per-provider adapters → Tasks 11–14; UI diffing + reply + crash recovery → Tasks 15–16; testing → Tasks 17–18.
2. **Placeholders fixed:** None remained. The per-provider Tasks 12–14 reference Task 11's pattern explicitly; they include their own factory-registration, test, and commit steps so they're self-contained.
3. **Type consistency:** `RunSessionWriteStatusOptions` (uses `pauseReason`) is the same shape consumed by `TaskNoteStore.writeStatus` (which also uses `pauseReason`). `TaskRunHandle` (Task 8) carries `stream` + `terminal` matching the spec exactly. `TaskRunCoordinator` deps drop `appendLedger`/`writeTaskStatus` legacy signatures and adopt `flushLedger(task, entries)` matching `RunSession.flushLedger`. Event keys in `TaskEventMap` match all emissions in `RunSession` and consumers in `AgentBoardView`.
4. **Open assumption:** The exact accessor on each chat-tab controller that gives the adapter its `onChunk` hook is provider-specific (no current public method exists). Tasks 11–14 each call this out and ask the implementer to add a minimal `provideStreamHandle()` accessor on the tab controller during that task. This is the only piece that requires light surgery beyond what the design enumerated; it is intentional given the spec's "TaskExecutionSurface stays thin" stance.
