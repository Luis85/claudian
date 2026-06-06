---
title: Collapsible Agent Board Lanes
date: 2026-06-06
status: shipped
scope: features/tasks
parent: "[[Agent Kanban Board]]"
source: "[[docs/ideas/Collapse first and last column of the Agent-Board]]"
---

# Collapsible Agent Board Lanes Design

## Summary

Allow any lane on the Agent Board to be marked **collapsible** in the lane editor. A collapsible lane shows a chevron in its header; clicking it shrinks the lane to a narrow vertical strip showing the lane title (rotated) and a count badge. Clicking the strip expands the lane again. Collapse state persists in board config across sessions, per lane. Cards moving into a collapsed lane do **not** auto-expand it — the count bumps silently. The original motivation is reducing clutter from terminal lanes (Inbox/Done), but the mechanism applies to any lane the user opts into.

## Motivation

The Agent Board can display up to eleven lanes (one per `TaskStatus`). Terminal lanes (Inbox, Done, Canceled, Failed) and pre-flight lanes accumulate cards but rarely need direct attention while running work. They consume horizontal space and visual weight that belongs to active lanes (Running, Needs input, Needs approval, Review). Letting the user collapse low-attention lanes recovers that space without losing the count signal.

## Decisions (locked during brainstorming)

| Question | Decision |
|---------|---------|
| Which lanes collapse? | Per-lane opt-in via config — not positional, not hard-coded to first/last. |
| State persistence | Persistent across sessions, stored in `BoardConfig`. |
| Collapsed visual | Narrow vertical strip with vertically-rotated lane title + count badge. |
| Expand trigger | Click anywhere on collapsed strip. |
| Collapse trigger | Dedicated chevron icon in lane header (only shown when `collapsible`). |
| Configuration UI | Per-lane "Collapsible" toggle in `AgentBoardLaneEditor` (no JSON-only path). |
| Behavior on card arrival | Silent count bump — no auto-expand, no flash. |
| Storage approach | Single source of truth in `BoardLaneConfig` (Approach A from brainstorming). |

## Architecture

### Data model

Extend `BoardLaneConfig` (`src/features/tasks/config/boardConfigTypes.ts`):

```ts
export interface BoardLaneConfig {
  id: string;
  title: string;
  statuses: TaskStatus[];
  visible: boolean;
  definitionOfReady: string[];
  definitionOfDone: string[];
  collapsible: boolean;  // config-time opt-in
  collapsed: boolean;    // runtime user toggle, persisted
}
```

`ResolvedLane` gains the same two fields, passed through unchanged by `resolveBoardLayout`.

Defaults: both `false` for new lanes and for `DEFAULT_BOARD_CONFIG`.

### Storage and write path

`src/features/tasks/config/BoardConfigStore.ts`:

- New pure helper `writeLaneCollapsed(config, laneId, collapsed): BoardConfig` mirroring `writeBoardQueuePaused`. Clones config, finds lane by id, returns new config with the lane's `collapsed` flag updated. Non-existent `laneId` returns the input config unchanged.
- `loadBoardConfig` migrates legacy configs: any lane missing `collapsible` or `collapsed` is filled with `false` in memory. The file is **not** rewritten on load — only when the user mutates board config does the migration land on disk.

`AgentBoardView`:

- New handler `onToggleLaneCollapse(laneId: string)` reads current config, applies `writeLaneCollapsed`, persists through the existing atomic write path, re-resolves layout, and re-renders.
- Toggling a non-collapsible lane is a defensive no-op (the renderer should not expose the toggle in that case, but the handler guards regardless).

### Rendering

`src/features/tasks/ui/AgentBoardRenderer.ts`:

Add to `AgentBoardRenderCallbacks`:

```ts
onToggleLaneCollapse(laneId: string): void;
```

`renderLane` branches:

- **Collapsed branch** (`lane.collapsible && lane.collapsed`): render `.claudian-agent-board-lane--collapsed` strip with a vertically-rotated `lane.title` span and a count badge equal to `lane.tasks.length`. The whole strip is the click target → `onToggleLaneCollapse(lane.id)`. No cards rendered. No `CardRefs` registered for this lane.
- **Expanded branch** (default): render the existing lane layout. If `lane.collapsible`, the header gets a chevron button (`›`) beside the count → `onToggleLaneCollapse(lane.id)`. Non-collapsible lanes render exactly as today.

Live patching (`patchCard`, `patchLiveStrip`) is unaffected: collapsed lanes register no `CardRefs`, so any patch for a task currently sitting in a collapsed lane silently no-ops. When a task transitions into a collapsed lane during a run, the full `render()` triggered by the index change increments the count badge — no auto-expand, no animation.

### Styling

`src/style/features/agent-board.css`:

```css
.claudian-agent-board-lane--collapsed {
  min-width: 36px;
  max-width: 36px;
  padding: 8px 4px;
  cursor: pointer;
  align-items: center;
}

.claudian-agent-board-lane--collapsed .claudian-agent-board-lane-title-vertical {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-weight: var(--font-semibold);
  color: var(--text-normal);
  white-space: nowrap;
}

.claudian-agent-board-lane--collapsed .claudian-agent-board-lane-count {
  margin-top: 8px;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--background-modifier-border);
}

.claudian-agent-board-lane-collapse-toggle {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
}

.claudian-agent-board-lane-collapse-toggle:hover {
  color: var(--text-normal);
}
```

Accessibility: chevron button gets `aria-label="Collapse lane"` (or `"Expand lane"` if also used on the strip); collapsed strip gets `role="button"` and `aria-expanded="false"`.

### Lane editor UI

`src/features/tasks/ui/AgentBoardLaneEditor.ts`:

Add a per-lane "Collapsible" checkbox row alongside the existing "Visible" toggle. On change, mutate `collapsible` through the existing lane mutation path. Un-checking `collapsible` while the lane is currently `collapsed` must force `collapsed = false` in the same write, so no orphan collapsed state remains on a non-collapsible lane.

The `collapsed` flag itself is **not** exposed in the editor — that is a runtime toggle from the board, not a config-time setting.

## Components and boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `boardConfigTypes.ts` | Type contract for lane config including new flags | none |
| `BoardConfigStore.ts` | `writeLaneCollapsed` pure helper, load-time migration | `boardConfigTypes` |
| `resolveBoardLayout.ts` | Passes flags through to `ResolvedLane` | `boardConfigTypes` |
| `AgentBoardRenderer.ts` | Branches `renderLane` on collapsed state, exposes chevron/strip handlers | `boardConfigTypes` |
| `AgentBoardView.ts` | Wires `onToggleLaneCollapse` to store write + re-render | `BoardConfigStore`, `AgentBoardRenderer` |
| `AgentBoardLaneEditor.ts` | Editor UI for `collapsible` flag | `BoardConfigStore` |
| `agent-board.css` | Collapsed strip and chevron styling | none |

Boundary check: each unit is independently testable. The renderer takes config + callbacks and renders; the view wires storage to renderer; the store is pure. No new cross-feature dependencies.

## Error handling

- Malformed lane id in `writeLaneCollapsed` → return original config (no throw).
- Toggling a non-collapsible lane via the view handler → no-op write skipped, no re-render triggered.
- Legacy config loaded without new fields → defaults injected in memory; file rewrites only when the user mutates.
- Render of a collapsed lane that suddenly becomes non-collapsible via concurrent edit → the next `render()` re-evaluates the branch; the editor write also clears `collapsed`, so the strip will not persist.

## Testing

Unit tests under `tests/unit/features/tasks/`:

- `config/boardConfigTypes.test.ts` — `DEFAULT_BOARD_CONFIG` lanes have `collapsible: false`, `collapsed: false`.
- `config/BoardConfigStore.test.ts` — `writeLaneCollapsed` toggles the correct lane; unknown lane id returns input; legacy config without the new fields hydrates with defaults at load.
- `config/resolveBoardLayout.test.ts` — `collapsible` and `collapsed` pass through to `ResolvedLane`.
- `ui/AgentBoardRenderer.test.ts` — collapsed lane renders strip (no cards); chevron present iff `collapsible && !collapsed`; both strip click and chevron click fire `onToggleLaneCollapse(laneId)`; count reflects `lane.tasks.length` even when the lane is collapsed.
- `ui/AgentBoardLaneEditor.test.ts` — checkbox toggles `collapsible`; un-checking `collapsible` clears `collapsed` in the same write.

No new integration test required: the existing Agent Board integration tests already exercise lane render and config persistence; the unit seam fully covers the new behavior.

## YAGNI / non-goals

- No animation on collapse/expand.
- No auto-expand on card arrival, hover, or run completion.
- No keyboard shortcut to collapse/expand (deferred until a user asks).
- No drag-and-drop across collapsed lanes (cards can still move via status changes; manual drag is out of scope).
- No "collapse all" / "expand all" board-level action.
- No exposure of the `collapsed` flag in the lane editor — runtime-only toggle.

## Open questions

None at spec time. All resolved during brainstorming.

## Migration

Existing board configs on disk lack the new fields. `loadBoardConfig` injects defaults in memory; no forced rewrite. The next user-initiated config write (lane edit, queue toggle, collapse toggle) persists the migrated shape. No version bump required — `schemaVersion: 1` continues to apply because additive optional-with-default fields are backwards compatible.
