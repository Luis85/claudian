---
title: Archive Action in Work-Order Context Menu
date: 2026-06-06
status: implemented
scope: features/tasks
parent: "[[Agent Kanban Board]]"
---

# Archive Action in Work-Order Context Menu Design

## Summary

Surface the existing **Archive work order** action in the right-click context menu of an Agent Board work-order card. The menu item is visible only when the card is in a terminal status (`done`, `failed`, `canceled`), reuses the existing confirm-dialog + `archiveWorkOrder` path, and lives at the bottom of the menu (after quick actions, separated by a divider). No new business logic — purely a new entry point.

## Motivation

The Agent Board already supports archiving via the `WorkOrderDetailModal` (Archive button). Reaching it requires clicking the card to open the modal. For housekeeping on terminal cards — clearing finished/failed/canceled work orders off the board — the right-click menu is the natural fast path. Users have been opening the modal solely to click Archive.

## Decisions (locked during brainstorming)

| Question | Decision |
|---------|---------|
| Which statuses qualify? | All terminal statuses: `done`, `failed`, `canceled`. |
| Confirmation dialog? | Reuse the existing `confirm()` modal (no silent archive). |
| Menu placement | Bottom, after quick-action favorites/picker, behind its own separator. |
| New business logic? | None. Reuses `archiveWorkOrder` and `AgentBoardView.archiveTask`. |

## Architecture

### Surface — `WorkOrderContextMenu`

`src/features/tasks/ui/WorkOrderContextMenu.ts`:

`WorkOrderContextMenuDeps` gains a new required field:

```ts
onArchive: (task: TaskSpec) => void;
```

`showWorkOrderContextMenu` appends, after the existing quick-actions block:

```ts
const ARCHIVABLE_STATUSES = new Set(['done', 'failed', 'canceled']);

if (ARCHIVABLE_STATUSES.has(task.frontmatter.status)) {
  menu.addSeparator();
  menu.addItem((item) => item
    .setTitle(t('tasks.board.contextMenu.archive'))
    .setIcon('archive')
    .onClick(() => onArchive(task)));
}
```

The separator is added inside the gate so non-terminal cards never see a trailing empty divider.

### Wiring — `AgentBoardView`

`src/features/tasks/ui/AgentBoardView.ts`:

The block that constructs the `WorkOrderContextMenuDeps` object adds:

```ts
onArchive: (target) => void this.archiveTask(target),
```

`AgentBoardView.archiveTask` already exists: confirms via `confirm()`, calls `archiveWorkOrder`, surfaces a `Notice` on success, refreshes the board. No changes required.

### i18n

New key `tasks.board.contextMenu.archive` added to all 10 locales:

- `en.json`: `"Archive"`
- `de.json`: `"Archivieren"`
- `es.json`: `"Archivar"`
- `fr.json`: `"Archiver"`
- `ja.json`: `"アーカイブ"`
- `ko.json`: `"보관"`
- `pt.json`: `"Arquivar"`
- `ru.json`: `"В архив"`
- `zh-CN.json`: `"归档"`
- `zh-TW.json`: `"封存"`

Each key sits alongside the existing `openNote` / `openConversation` keys under the same `tasks.board.contextMenu` object.

## Components and boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `WorkOrderContextMenu.ts` | Render the menu, gate Archive by status, dispatch `onArchive` | i18n, `TaskSpec` |
| `AgentBoardView.ts` (existing `archiveTask`) | Confirm + invoke `archiveWorkOrder` + Notice + refresh | `commands/taskCommands` |
| i18n locale JSON | Translation strings | none |

Boundary check: the renderer→view callback seam (`onContextMenu`) stays unchanged. The new `onArchive` is one more deps field, mirroring `onOpenNote` / `onOpenConversation`. No new cross-feature coupling.

## Error handling

- Archive of a card whose backing note has been moved/deleted: `archiveWorkOrder` already handles missing-file by returning a falsy destination; `archiveTask` skips the success Notice in that case. Existing behavior, unchanged.
- User cancels the confirm dialog: no-op. Existing behavior.
- A card transitions out of the terminal set mid-right-click (rare race): the menu was already built from the snapshot — if the user clicks Archive, the confirm + archive path still runs; if the run reactivated the card, archiving a `running` card is the user's explicit choice through a confirmed action. Acceptable.

## Testing

`tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts` — extend existing suite:

- Status `done` → menu contains Archive item; click fires `onArchive(task)`.
- Status `failed` → Archive item present.
- Status `canceled` → Archive item present.
- Status `running` → Archive item absent.
- Status `ready` → Archive item absent.
- Status `inbox` → Archive item absent.

Reuse the existing Menu mock and deps factory in the test file.

No new integration test required — the archive flow itself is already covered through the detail-modal path; this spec only adds a new entry point.

## YAGNI / non-goals

- No bulk-archive (multi-select) — out of scope.
- No keyboard shortcut for archive — deferred until requested.
- No undo — the existing archive path has no undo and this spec does not add one. The note is moved (not deleted), so manual recovery from the archive folder is the existing escape hatch.
- No "Archive without confirm" preference — confirmation is consistent across both entry points.

## Migration

None. Purely additive UI surface.
