---
status: approved
---
# Internal Event Bus Design

Date: 2026-05-29
Status: proposed for user review
Source issue: [[docs/issues/Missing Eventbus makes expanding or integrating harder than it should be.md]]

## Summary

Add a small, typed, in-process event bus so plugin modules can react to each other without direct references. Replace the ad-hoc cross-feature wiring added during Agent Board work (chat reaching into tasks through `plugin.refreshAgentBoardSlots()`, settings calling `plugin.refreshAgentBoards()`) with published events that interested modules subscribe to.

Scope is a "moderate seed": the bus itself, the events needed to remove the current coupling (chat tab changes, board-config changes), plus task lifecycle events emitted to set the convention. Internal only — no public/external API.

## Goals

- A generic, typed `EventBus` with no Obsidian dependency (unit-testable).
- Per-feature event maps composed at the app layer, so adding events doesn't create back-dependencies.
- Producers emit; consumers subscribe with disposer-based cleanup tied to Obsidian component lifecycle.
- Remove `plugin.refreshAgentBoards` / `plugin.refreshAgentBoardSlots` and their call sites, replacing them with events.

## Non-goals

- Chat stream/conversation events, ask-user, plan events.
- Async dispatch, wildcard/regex listeners, event replay/buffering.
- Public/external (third-party) event API.
- Logger integration (tracked separately in `docs/issues/insufficient logging.md`).

## Decisions

| Question | Decision |
|----------|----------|
| Foundation | Typed standalone `EventBus<M>` class in `core/` (no Obsidian dep) |
| Event map | Per-feature maps composed in the app layer |
| Dispatch | Synchronous, error-isolated per handler |
| Ownership | One `EventBus` instance owned by the plugin, accessed as `plugin.events` |
| Cleanup | `on()` returns a disposer; views register it via `Component.register` |
| Seed scope | Bus + chat tab event + board-config event + task lifecycle events |

## Architecture

### Layering

- `src/core/events/EventBus.ts` — generic `EventBus<M extends EventMap>`. No imports from `features/` or `app/`. Unit-testable in isolation.
- `src/features/chat/events.ts` — `ChatEventMap` (chat-owned events).
- `src/features/tasks/events.ts` — `TaskEventMap` (task-owned events; may import `TaskStatus` from the same feature).
- `src/app/events/claudianEvents.ts` — `export type ClaudianEventMap = ChatEventMap & TaskEventMap;` (app composes; app may depend on features).
- `src/main.ts` — `readonly events = new EventBus<ClaudianEventMap>();` created in `onload`, exposed as `plugin.events`.

Features emit/subscribe through `plugin.events`. The type flows from `ClaudianPlugin` (which features already import), so no feature needs to import the composed app map directly — no feature→app back-dependency.

### EventBus

```ts
export type EventMap = Record<string, unknown>;
export type EventHandler<P> = (payload: P) => void;

export class EventBus<M extends EventMap> {
  private readonly handlers = new Map<keyof M, Set<EventHandler<unknown>>>();

  on<K extends keyof M>(event: K, handler: EventHandler<M[K]>): () => void;
  off<K extends keyof M>(event: K, handler: EventHandler<M[K]>): void;
  emit<K extends keyof M>(event: K, payload: M[K]): void;
}
```

- `on` adds the handler and returns a disposer that removes it.
- `emit` iterates a snapshot (`[...set]`) so handlers added/removed during dispatch don't corrupt iteration; each handler runs in its own `try/catch` so one throwing handler neither breaks the others nor the producer. (Errors are swallowed for now; a `// TODO` notes they should route to the future logger.)
- No-listener `emit` is a cheap no-op.
- For `void` payload events, `emit(event)` is callable with no payload argument (typed so `M[K] extends void` makes the payload optional).

### Event map (seed)

```ts
// features/chat/events.ts
export interface ChatEventMap {
  'chat:tabs-changed': { openCount: number };
}

// features/tasks/events.ts
import type { TaskStatus } from './model/taskTypes';
export interface TaskEventMap {
  'task:board-config-changed': void;
  'task:run-started': { taskId: string; path: string };
  'task:status-changed': { taskId: string; path: string; status: TaskStatus };
  'task:run-finished': { taskId: string; path: string; status: TaskStatus };
}
```

## Producers

- **`TabManager.createTab` / `closeTab`** — emit `chat:tabs-changed` with `{ openCount: this.tabs.size }`. Remove the `this.plugin.refreshAgentBoardSlots()` calls added previously.
- **`AgentBoardSettingsSection`** (lane editor save + work-order-folder change) — emit `task:board-config-changed`. Remove the `plugin.refreshAgentBoards()` calls.
- **`AgentBoardView`** —
  - `runTask`: emit `task:run-started` before the run, `task:run-finished` (with the result status) after.
  - the injected `writeTaskStatus` dep and `transitionTask`: emit `task:status-changed` whenever a status is written. `TaskRunCoordinator` stays plugin-free (the view owns emission).

## Consumers

- **`AgentBoardView.onOpen`** registers two subscriptions, each via `this.register(...)` (an `ItemView` is a `Component`, so they are disposed on view close):
  - `plugin.events.on('chat:tabs-changed', () => this.refreshSlots())`
  - `plugin.events.on('task:board-config-changed', () => void this.refresh())`
- The board continues to self-refresh after its own mutations (run, transition, save, add). Events handle only **external** triggers (chat tabs, settings changes).
- `task:run-started` / `status-changed` / `run-finished` have no consumers yet; they are emitted to establish the convention.

## Cleanup / Migration

- Delete `plugin.refreshAgentBoards()` and `plugin.refreshAgentBoardSlots()` and all their call sites; behavior is preserved through events.
- `TabManager` no longer references board refresh; it only emits.
- `AgentBoardSettingsSection` emits instead of calling plugin refresh methods.
- Update `tests/unit/features/chat/tabs/TabManager.test.ts`: the mock plugin gains a real (or fake) `events` bus; drop the `refreshAgentBoardSlots` mock; assert `chat:tabs-changed` is emitted on create/close.

## Error Handling

- A throwing subscriber is caught per-handler in `emit`; other handlers still run and the producer is unaffected.
- Until the logger lands, caught errors are swallowed with a `// TODO: route to logger` marker (do not use `console.*`).

## Testing Plan

TDD, mirrored under `tests/unit/`.

### `EventBus` (unit)
- `on` then `emit` delivers the payload.
- Multiple handlers for one event all fire.
- The disposer returned by `on` removes only that handler.
- `off` removes a handler.
- A handler that throws does not prevent other handlers from running and does not throw out of `emit`.
- `emit` with no subscribers is a no-op.
- (Compile-time) payload types are enforced by the event map.

### `TabManager` (unit)
- `createTab` emits `chat:tabs-changed` with the new open count.
- `closeTab` emits `chat:tabs-changed` with the decremented count.
- (Replaces the previous `refreshAgentBoardSlots` expectation.)

### Integration / non-regression
- Opening/closing a chat tab updates the board's slot indicator via the event (no direct plugin refresh call).
- Saving board config (lanes/folder) refreshes the board via `task:board-config-changed`.
- Direct chat send/stream path is unaffected (no dependency on the bus).

## Manual Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Smoke test:
1. Open Agent Board; open/close chat tabs → slot count updates.
2. Edit board lanes in settings → board refreshes.
3. Run a work order → board behaves as before (self-refresh).
4. Confirm direct chat still works.

## Acceptance Criteria

- A typed `EventBus` exists in `core/`, unit-tested, with no Obsidian dependency.
- Chat tab open/close and board-config changes drive the board through events, not direct plugin refresh calls.
- `plugin.refreshAgentBoards` / `refreshAgentBoardSlots` are removed.
- Task lifecycle events are emitted (no required consumers yet).
- Subscriptions clean up on view close; a throwing subscriber cannot break others or the producer.
- All existing tests pass; new `EventBus` and `TabManager` emit tests pass.

## Risks

- Subscriptions that forget cleanup leak listeners — mitigated by the disposer + `Component.register` pattern (document it in `features/*/CLAUDE.md`).
- Emitting events with no consumers (task lifecycle) is mild speculative surface; kept minimal and justified as convention-setting.
- Swallowed handler errors are invisible until the logger exists — marked with a TODO so they migrate.
