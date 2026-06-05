---
title: Right-click menu quick actions overhaul
date: 2026-06-05
status: approved
scope: context menus
---

# Right-click Menu Quick Actions Overhaul Design

## Goal

Make Claudian-owned right-click menu entries easier to scan by bracketing the file/folder menu contribution with separators, placing primary actions first, renaming the quick-action picker to `Open Quick Actions`, and ensuring Agent Board work-order menus show the picker before favorite quick actions.

## Affected Surfaces

- Workspace file context menu for `TFile` entries.
- Workspace folder context menu for `TFolder` entries.
- Agent Board work-order card context menu when the work-order note resolves to a `TFile` and is not running.

## Menu Layout

Workspace file menu:

1. Separator
2. `Add file to Claudian chat`
3. `Create work order`
4. `Open Quick Actions`
5. Favorite quick actions in cache order
6. Separator

Workspace folder menu:

1. Separator
2. `Add folder to Claudian chat`
3. `Create work order`
4. `Open Quick Actions`
5. Favorite quick actions in cache order
6. Separator

Agent Board work-order menu:

1. `Open note`
2. Optional `Open conversation`
3. Separator before the quick-action block
4. `Open Quick Actions`
5. Favorite quick actions in cache order

The Agent Board menu keeps its existing gates: the quick-action block is hidden while the work order is running or when the work-order path no longer resolves to a `TFile`.

## Implementation Approach

Update the shared quick-action menu helper so all callers get one consistent picker-before-favorites layout. Rename the localized context-menu title to `Open Quick Actions`. Add leading and trailing separators around Claudian's workspace file/folder menu contribution in `registerWorkspaceMenus`.

## Testing

Use TDD against existing menu tests:

- `tests/unit/app/commands/registerWorkspaceMenus.test.ts` should assert leading and trailing separators, primary action order, picker title, and favorites after the picker.
- `tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts` should assert Agent Board picker-before-favorites ordering and existing gated paths.
- `tests/integration/main.test.ts` should assert the loaded plugin registers the workspace menu in the new order.
