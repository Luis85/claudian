---
status: done
parent: Infrastructure
---
# Internal Event Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed in-process event bus and migrate the Agent Board's cross-feature coupling (chat tab changes, board-config changes) from direct `plugin.refresh*` calls to published events.

**Architecture:** A generic `EventBus<M>` lives in `core/` (no Obsidian dependency). Per-feature event maps (`features/chat/events.ts`, `features/tasks/events.ts`) are composed at the app layer into `ClaudianEventMap`. The plugin owns one `EventBus<ClaudianEventMap>` as `plugin.events`; producers emit, the Agent Board subscribes with disposer cleanup.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest.

---

## Spec

Implements [[2026-05-29-internal-event-bus-design]]. Out of scope: chat stream/conversation events, async/wildcard dispatch, public API, logger integration.

## File Structure

Create:
- `src/core/events/EventBus.ts` — generic typed bus (on/off/emit, sync, error-isolated).
- `src/features/chat/events.ts` — `ChatEventMap`.
- `src/features/tasks/events.ts` — `TaskEventMap`.
- `src/app/events/claudianEvents.ts` — `ClaudianEventMap = ChatEventMap & TaskEventMap`.
- `tests/unit/core/events/EventBus.test.ts`.

Modify:
- `src/main.ts` — add `events` field; remove `refreshAgentBoards` + `refreshAgentBoardSlots`.
- `src/features/chat/tabs/TabManager.ts` — emit `chat:tabs-changed` (was `plugin.refreshAgentBoardSlots()`).
- `src/features/tasks/ui/AgentBoardLaneEditor.ts` — emit `task:board-config-changed` (was `plugin.refreshAgentBoards()`).
- `src/features/settings/ui/AgentBoardSettingsSection.ts` — emit `task:board-config-changed` (was `plugin.refreshAgentBoards()`).
- `src/features/tasks/ui/AgentBoardView.ts` — subscribe to `chat:tabs-changed` + `task:board-config-changed`; emit `task:run-started`/`status-changed`/`run-finished`.
- `tests/unit/features/chat/tabs/TabManager.test.ts` — mock plugin gains an `events` bus; assert emit; drop `refreshAgentBoardSlots`.

---

### Task 1: EventBus core module

**Files:**
- Create: `src/core/events/EventBus.ts`
- Test: `tests/unit/core/events/EventBus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/events/EventBus.test.ts`:

```ts
import { EventBus } from '../../../../src/core/events/EventBus';

interface TestMap {
  'thing:happened': { value: number };
  'thing:pinged': void;
}

describe('EventBus', () => {
  it('delivers the payload to a subscribed handler', () => {
    const bus = new EventBus<TestMap>();
    const seen: number[] = [];
    bus.on('thing:happened', (p) => seen.push(p.value));
    bus.emit('thing:happened', { value: 7 });
    expect(seen).toEqual([7]);
  });

  it('fires every handler subscribed to an event', () => {
    const bus = new EventBus<TestMap>();
    const seen: string[] = [];
    bus.on('thing:happened', () => seen.push('a'));
    bus.on('thing:happened', () => seen.push('b'));
    bus.emit('thing:happened', { value: 1 });
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('stops delivering after the disposer runs', () => {
    const bus = new EventBus<TestMap>();
    const seen: number[] = [];
    const dispose = bus.on('thing:happened', (p) => seen.push(p.value));
    bus.emit('thing:happened', { value: 1 });
    dispose();
    bus.emit('thing:happened', { value: 2 });
    expect(seen).toEqual([1]);
  });

  it('off removes a specific handler', () => {
    const bus = new EventBus<TestMap>();
    const seen: number[] = [];
    const handler = (p: { value: number }): void => { seen.push(p.value); };
    bus.on('thing:happened', handler);
    bus.off('thing:happened', handler);
    bus.emit('thing:happened', { value: 1 });
    expect(seen).toEqual([]);
  });

  it('isolates a throwing handler from the others and the producer', () => {
    const bus = new EventBus<TestMap>();
    const seen: string[] = [];
    bus.on('thing:happened', () => { throw new Error('boom'); });
    bus.on('thing:happened', () => seen.push('ran'));
    expect(() => bus.emit('thing:happened', { value: 1 })).not.toThrow();
    expect(seen).toEqual(['ran']);
  });

  it('emitting with no subscribers is a no-op', () => {
    const bus = new EventBus<TestMap>();
    expect(() => bus.emit('thing:happened', { value: 1 })).not.toThrow();
  });

  it('supports void-payload events emitted with no argument', () => {
    const bus = new EventBus<TestMap>();
    let count = 0;
    bus.on('thing:pinged', () => { count += 1; });
    bus.emit('thing:pinged');
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --runTestsByPath tests/unit/core/events/EventBus.test.ts
```

Expected: FAIL with a module-not-found error for `EventBus`.

- [ ] **Step 3: Implement EventBus**

Create `src/core/events/EventBus.ts`:

```ts
export type EventMap = Record<string, unknown>;
export type EventHandler<P> = (payload: P) => void;

/**
 * Minimal typed, synchronous, in-process event bus.
 * No Obsidian dependency so it can be unit-tested in isolation.
 */
export class EventBus<M extends EventMap> {
  private readonly handlers = new Map<keyof M, Set<EventHandler<never>>>();

  on<K extends keyof M>(event: K, handler: EventHandler<M[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof M>(event: K, handler: EventHandler<M[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  emit<K extends keyof M>(event: K, ...args: M[K] extends void ? [] : [M[K]]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    const payload = (args.length > 0 ? args[0] : undefined) as M[K];
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<M[K]>)(payload);
      } catch {
        // TODO: route to logger once available (see docs/issues/insufficient logging.md).
        // Swallow so one bad subscriber cannot break others or the producer.
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --runTestsByPath tests/unit/core/events/EventBus.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/events/EventBus.ts tests/unit/core/events/EventBus.test.ts
git commit -m "feat: add typed in-process event bus"
```

---

### Task 2: Event maps and plugin wiring (additive)

**Files:**
- Create: `src/features/chat/events.ts`
- Create: `src/features/tasks/events.ts`
- Create: `src/app/events/claudianEvents.ts`
- Modify: `src/main.ts`

This task is additive — it adds `plugin.events` without removing the old methods yet, so the tree keeps compiling.

- [ ] **Step 1: Create the chat event map**

Create `src/features/chat/events.ts`:

```ts
export interface ChatEventMap {
  /** Emitted when a chat tab is opened or closed. */
  'chat:tabs-changed': { openCount: number };
}
```

- [ ] **Step 2: Create the tasks event map**

Create `src/features/tasks/events.ts`:

```ts
import type { TaskStatus } from './model/taskTypes';

export interface TaskEventMap {
  /** Emitted when Agent Board configuration (lanes/folder) changes. */
  'task:board-config-changed': void;
  /** Emitted when a work-order run begins. */
  'task:run-started': { taskId: string; path: string };
  /** Emitted whenever a work order's status is written. */
  'task:status-changed': { taskId: string; path: string; status: TaskStatus };
  /** Emitted when a work-order run ends. */
  'task:run-finished': { taskId: string; path: string; status: TaskStatus };
}
```

- [ ] **Step 3: Compose the app event map**

Create `src/app/events/claudianEvents.ts`:

```ts
import type { ChatEventMap } from '../../features/chat/events';
import type { TaskEventMap } from '../../features/tasks/events';

export type ClaudianEventMap = ChatEventMap & TaskEventMap;
```

- [ ] **Step 4: Add the bus to the plugin**

In `src/main.ts`:

Add the imports (with the other imports near the top):

```ts
import { EventBus } from './core/events/EventBus';
import type { ClaudianEventMap } from './app/events/claudianEvents';
```

Add the field to the `ClaudianPlugin` class, right after `settings!: ClaudianSettings;`:

```ts
  readonly events = new EventBus<ClaudianEventMap>();
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
git add src/features/chat/events.ts src/features/tasks/events.ts src/app/events/claudianEvents.ts src/main.ts
git commit -m "feat: add composed event map and plugin event bus"
```

Expected: typecheck PASS (purely additive).

---

### Task 3: Migrate producers/consumers and remove old refresh methods

**Files:**
- Modify: `src/features/chat/tabs/TabManager.ts`
- Modify: `src/features/tasks/ui/AgentBoardLaneEditor.ts`
- Modify: `src/features/settings/ui/AgentBoardSettingsSection.ts`
- Modify: `src/features/tasks/ui/AgentBoardView.ts`
- Modify: `src/main.ts`
- Modify: `tests/unit/features/chat/tabs/TabManager.test.ts`

All edits land together so the tree compiles (callers move off the methods as the methods are removed).

- [ ] **Step 1: TabManager emits instead of refreshing**

In `src/features/chat/tabs/TabManager.ts`, replace both `this.plugin.refreshAgentBoardSlots();` calls (one near the end of `createTab`, one in `closeTab` after `this.tabs.delete(tabId)`) with:

```ts
    this.plugin.events.emit('chat:tabs-changed', { openCount: this.tabs.size });
```

(In `createTab` the new tab is already in `this.tabs`, so `this.tabs.size` is the post-open count; in `closeTab` it runs after the delete, so it is the post-close count.)

- [ ] **Step 2: Lane editor and settings emit board-config-changed**

In `src/features/tasks/ui/AgentBoardLaneEditor.ts`, in the `persist` function, replace:

```ts
    plugin.refreshAgentBoards();
```

with:

```ts
    plugin.events.emit('task:board-config-changed');
```

In `src/features/settings/ui/AgentBoardSettingsSection.ts`, in the work-order-folder `onChange`, replace:

```ts
          plugin.refreshAgentBoards();
```

with:

```ts
          plugin.events.emit('task:board-config-changed');
```

- [ ] **Step 3: AgentBoardView subscribes and emits task events**

In `src/features/tasks/ui/AgentBoardView.ts`:

In `onOpen`, add the two subscriptions immediately before `await this.refresh();`:

```ts
    this.register(this.plugin.events.on('chat:tabs-changed', () => this.refreshSlots()));
    this.register(this.plugin.events.on('task:board-config-changed', () => void this.refresh()));
```

In `transitionTask`, after the `writeStatus` `applyNoteChange` call and before the `appendLedger` call, emit a status change:

```ts
    await this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, { status: to, timestamp }));
    this.plugin.events.emit('task:status-changed', { taskId: latest.frontmatter.id, path: task.path, status: to });
    await this.applyNoteChange(task.path, (content) =>
      this.noteStore.appendLedger(content, { timestamp, status: to, message }),
    );
```

In `runTask`, change the coordinator's `writeTaskStatus` dependency to emit after each write:

```ts
      writeTaskStatus: async (_task, options) => {
        await this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, options));
        this.plugin.events.emit('task:status-changed', {
          taskId: latest.frontmatter.id,
          path: task.path,
          status: options.status,
        });
      },
```

Still in `runTask`, wrap the run with start/finish events. Replace:

```ts
    const result = await coordinator.run(latest);
    if (!result.ok) {
      new Notice(`Work order run failed: ${result.error}`);
    }
    await this.refresh();
```

with:

```ts
    this.plugin.events.emit('task:run-started', { taskId: latest.frontmatter.id, path: task.path });
    const result = await coordinator.run(latest);
    this.plugin.events.emit('task:run-finished', {
      taskId: latest.frontmatter.id,
      path: task.path,
      status: result.ok ? result.status : 'failed',
    });
    if (!result.ok) {
      new Notice(`Work order run failed: ${result.error}`);
    }
    await this.refresh();
```

- [ ] **Step 4: Remove the old plugin methods**

In `src/main.ts`, delete both methods entirely:

```ts
  refreshAgentBoards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_AGENT_BOARD)) {
      const view = leaf.view;
      if (view instanceof AgentBoardView) {
        void view.refresh();
      }
    }
  }

  refreshAgentBoardSlots(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_AGENT_BOARD)) {
      const view = leaf.view;
      if (view instanceof AgentBoardView) {
        view.refreshSlots();
      }
    }
  }
```

(`AgentBoardView` may now be an unused import in `main.ts`. If `npm run typecheck` or `npm run lint` flags it as unused, remove the `AgentBoardView` import; if it is still used elsewhere in `main.ts`, leave it.)

- [ ] **Step 5: Update the TabManager test**

In `tests/unit/features/chat/tabs/TabManager.test.ts`:

Add the import at the top:

```ts
import { EventBus } from '../../../../src/core/events/EventBus';
```

In `createMockPlugin`, remove the `refreshAgentBoardSlots: jest.fn(),` line and add an `events` bus instead:

```ts
    findConversationAcrossViews: jest.fn().mockReturnValue(null),
    events: new EventBus<any>(),
    ...overrides,
```

Add a test (place it near the other create/close tests):

```ts
  it('emits chat:tabs-changed when a tab is created and closed', async () => {
    const plugin = createMockPlugin();
    const manager = new TabManager(plugin, createMockMcpManager(), createMockEl(), createMockView(), {});
    const counts: number[] = [];
    plugin.events.on('chat:tabs-changed', (p: { openCount: number }) => counts.push(p.openCount));

    const tab = await manager.createTab(undefined, undefined, { activate: false });
    expect(counts.length).toBeGreaterThanOrEqual(1);
    if (tab) {
      await manager.closeTab(tab.id, true);
    }
    expect(counts[counts.length - 1]).toBe(0);
  });
```

(If `TabManager`'s constructor signature in this file's existing tests differs, match the existing construction pattern used by other tests in the file.)

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npm run test -- --selectProjects unit
npm run lint
```

Expected: typecheck PASS, all unit tests PASS, lint 0 errors.

If a unit suite fails with `plugin.events` being undefined (another test builds a plugin mock that creates/closes tabs), add an events bus to that file's plugin mock:

```ts
import { EventBus } from '<relative>/src/core/events/EventBus';
// in the mock plugin object:
events: new EventBus<any>(),
```

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/tabs/TabManager.ts src/features/tasks/ui/AgentBoardLaneEditor.ts src/features/settings/ui/AgentBoardSettingsSection.ts src/features/tasks/ui/AgentBoardView.ts src/main.ts tests/unit/features/chat/tabs/TabManager.test.ts
git commit -m "feat: drive Agent Board updates through the event bus"
```

Expected: commit succeeds.

---

### Task 4: Final verification and PR handoff

**Files:**
- Modify only files required to fix verification failures.

- [ ] **Step 1: Full verification**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all PASS.

- [ ] **Step 2: Confirm clean status**

```bash
git status --short
```

Expected: no uncommitted changes (or only a rebuilt `styles.css` if generated — commit it if tracked; it is gitignored in this repo, so usually nothing).

- [ ] **Step 3: Manual smoke test**

1. Reload the plugin; open Agent Board.
2. Open/close chat tabs → the board's "Chat tabs N/M" indicator updates (now via `chat:tabs-changed`).
3. Edit board lanes / work-order folder in settings → the board refreshes (via `task:board-config-changed`).
4. Run a work order → board behaves as before (self-refresh + status events fire).
5. Send a direct chat message without a work order → chat still works.

- [ ] **Step 4: PR summary**

```md
## Summary

- adds a typed, error-isolated in-process EventBus (core/events) with no Obsidian dependency
- composes per-feature event maps (chat + tasks) at the app layer into plugin.events
- migrates Agent Board updates off direct plugin.refresh* calls: chat emits chat:tabs-changed, settings emits task:board-config-changed, the board subscribes
- emits task lifecycle events (run-started/status-changed/run-finished) to set the convention
- removes plugin.refreshAgentBoards / refreshAgentBoardSlots

## Verification

- npm run typecheck
- npm run lint
- npm run test
- npm run build

## Risks

- task lifecycle events have no consumers yet (convention-setting)
- handler errors are swallowed until the logger lands (marked TODO)
```
```
