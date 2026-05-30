---
status: done
type: issue
tags:
  - infrastructure
priority: 1 - high
relations:
  - Infrastructure
---
# Missing event bus makes expanding or integrating harder than it should be

The Board and the chat panel do not emit events both modules can listen and react to. There is no decoupled pub/sub inside the plugin, so cross-feature coordination is wired as ad-hoc direct calls through the plugin (the composition root). Every new reaction means editing the emitter and adding another bespoke method — coupling grows with each feature.

## Goal

A lightweight, typed, **internal** event bus that lets modules emit and subscribe by event name without referencing each other. Streamline and ease up integrations and extension within the plugin. Internal scope only for now (a public/external API can come later).

## Current state (the pain, concretely)

Recent Agent Board work added exactly the kind of ad-hoc coupling a bus would remove:

- `plugin.refreshAgentBoards()` and `plugin.refreshAgentBoardSlots()` are plugin methods called from the settings UI and from `TabManager` (chat) to poke the Agent Board view.
- `TabManager.createTab` / `closeTab` now call `plugin.refreshAgentBoardSlots()` — chat code reaching through the plugin to drive a **tasks** view.
- `AgentBoardView` reads chat capacity via `plugin.getView()?.getTabManager()?.getTabCount()` — tasks reaching into chat.

This violates the spirit of the boundary in `CLAUDE.md` ("Direct chat must not depend on tasks"): the plugin indirection only partially hides that chat now triggers a tasks refresh. With a bus, chat would emit `chat:tabs-changed` knowing nothing about tasks; the board subscribes.

## Requirements

- **Typed event map:** event name → payload type; `emit`/`on`/`off` (maybe `once`) with full type inference.
- **Disposer-based subscriptions** compatible with Obsidian `Component.register(...)` / `registerEvent(...)` so listeners are cleaned up on view/plugin unload (no leaks).
- **No cross-feature imports:** the emitter must not import the subscriber.
- **Error isolation:** one listener throwing must not break other listeners or the emitter.
- **Cheap:** synchronous dispatch, near-zero cost when there are no listeners.

## Candidate events (seed list, to refine in design)

- chat: `chat:tab-opened`, `chat:tab-closed`, `chat:tabs-changed`, `chat:conversation-changed`, `chat:stream-started`, `chat:stream-ended`, `chat:error`.
- tasks: `task:workorder-created`, `task:run-started`, `task:status-changed`, `task:run-finished`, `task:board-config-changed`.
- settings: `settings:changed` (with changed key/area).

## First consumer (migration)

Replace the ad-hoc board/slot wiring as the first adopter:

- chat emits `chat:tabs-changed` on tab open/close instead of calling `plugin.refreshAgentBoardSlots()`.
- the Agent Board view subscribes to `chat:tabs-changed` and does its light slot re-render.
- settings emits `settings:changed` (or `task:board-config-changed`) instead of calling `plugin.refreshAgentBoards()`.

This both validates the bus and removes the current chat→tasks leak.

## Open questions (for design)

- Build on Obsidian's `Events` / `workspace.trigger` with custom event names, or a dedicated typed `EventBus` class? Obsidian `Events` integrates with `registerEvent` cleanup but is untyped-string; a typed wrapper is nicer.
- Synchronous vs async dispatch.
- Event naming convention and namespacing (`feature:thing-verb`).
- Where the bus lives: a plugin-level singleton injected into features (vs imported global).
- How much to migrate up front vs incrementally.

## Related

- Logging issue (`docs/issues/insufficient logging.md`) — both are cross-cutting infrastructure that would make the plugin easier to extend and debug.
- The board/slot coupling introduced on `feat/agent-board-configurable-lanes` is the concrete motivating case.

## Status

Deferred. To be tackled as its own brainstorm → spec → plan increment.
