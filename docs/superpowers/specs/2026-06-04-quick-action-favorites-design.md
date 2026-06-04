---
title: Quick action favorites in right-click menu
date: 2026-06-04
status: draft
scope: features/quickActions
---

## Problem

The right-click menu on a vault file or folder exposes a single "Quick action" entry that opens `QuickActionsModal`. Picking a frequently used action takes three interactions: open menu, click the entry, click the row. Users with a small set of go-to actions want one-click reach from the same menu.

## Goal

Let a user mark up to five quick actions as favorites and surface them as direct items in the `file-menu` and `folder-menu`, above the existing "Quick action…" entry. Clicking a favorite fires the same flow as the modal: open or reuse a chat tab, attach the right-clicked file or folder as a context pill, send the action's prompt.

## Non-goals

- Drag-and-drop reordering. Rank is assigned by star-click order; reorder by unstar + restar.
- Per-folder or per-file-type favorite scoping. Favorites are global.
- Surfacing favorites outside the right-click menu (no command palette entries, no toolbar buttons).
- Migration tooling for existing quick actions. Frontmatter fields are additive and default to "not favorite".

## Design

### Data model

Favorites live in each quick-action's YAML frontmatter. The file remains the canonical store, matching the existing pattern.

```yaml
---
type: quick-action
name: Refactor this
description: …
icon: wand
tags: [refactor]
favorite: true
favoriteRank: 2
---
```

- `favorite` is an optional boolean. Absent or `false` means not a favorite.
- `favoriteRank` is an integer in `1..5`, required only when `favorite` is `true`. Out-of-range or non-numeric values are ignored at parse time.
- `parseQuickActionContent` reads both fields. `serializeQuickAction` writes them only when `favorite === true`; clearing the favorite removes both lines.
- Gaps in the rank sequence (1, 2, 4, 5) are tolerated. The next star click fills the lowest unused slot.

### Modal star toggle

`QuickActionsModal` gains a star button on each row, left of the existing Edit and Delete buttons.

- Icon state: `star` (outline) when not a favorite, `star-filled` when `favorite === true`.
- Click toggles favorite state via `QuickActionStorage.setFavorite(action)` or `unsetFavorite(action)`. The storage method reads the action, mutates the frontmatter, writes back through the existing `save` path.
- Assignment helper `assignNextFavoriteRank(currentFavorites: QuickAction[]): number | null` returns the lowest unused rank in `1..5`, or `null` when all five slots are taken.
- When `assignNextFavoriteRank` returns `null`, the modal shows `Notice(t('quickActions.modal.favoriteLimitReached'))` and skips the write. The star icon stays outline.
- Star button is disabled while a save is in flight to prevent double-rank under fast double-click.
- Modal row layout: favorites group at the top sorted by rank ascending, separator row, remaining actions alphabetical. The search filter operates on a flat view and ignores the grouping.
- `aria-label`: `Mark as favorite` when outline; `Unmark favorite (slot N)` when filled.

### Favorites cache

The `file-menu` callback is synchronous, so favorites must be readable without awaiting a vault scan. `QuickActionFavoritesCache` provides that view.

- Constructor takes `QuickActionStorage`, `App`, and `() => string` for the folder path setting.
- `getFavorites(): QuickAction[]` returns the cached list sorted by `(favoriteRank ?? Infinity, name)`, capped at five entries.
- Subscribes via `app.vault.on('create' | 'modify' | 'delete' | 'rename', …)`. Handlers ignore paths outside `quickActionsFolder` and reload on matching events. Rename across the folder boundary is treated as create or delete.
- Re-subscribes when the folder path setting changes. Old folder events are dropped after re-subscribe.
- Cold cache (initial load in flight) returns an empty array. Menu degrades to showing only the existing "Quick action…" entry until the load resolves.

### Menu wiring

`registerWorkspaceMenus` reads the cache synchronously and injects fav items in both `file-menu` and `folder-menu`.

- For each `fav` in `cache.getFavorites()`:
  - `menu.addItem` with `title = fav.name`, `icon = fav.icon ?? 'star'`.
  - `onClick` calls `runQuickActionForFile(plugin, file, fav)`.
- The existing "Quick action…" entry stays below the favorites group, unchanged. It remains the path for non-favorite actions and for users who have not marked any.
- Item order in the menu: existing "Add to chat", "Create work order", favorites by rank, "Quick action…".

### Shared run flow

The body of the current `openContextMenuQuickAction` `onRun` callback is extracted into `runQuickActionForFile(plugin, file, action)`. Both the modal callback and the fav menu items call it. Behavior is unchanged:

1. Ensure the chat view is open.
2. Pick a target tab: reuse the active blank tab, or create a new one (notice on tab limit).
3. `switchToTab` to bring focus.
4. Attach the file or folder as a pill via `FileContextManager.attachFileAsPill` or `attachFolderAsPill`.
5. `inputController.sendMessage({ content: action.prompt })`.

### Code layout

New units:

| Path | Purpose |
|------|---------|
| `src/features/quickActions/QuickActionFavoritesCache.ts` | Synchronous favorites view backed by vault events. |
| `src/features/quickActions/runQuickActionForFile.ts` | Extracted run flow shared by modal and menu. |

Modified units:

| Path | Change |
|------|--------|
| `src/features/quickActions/types.ts` | Add `favorite?: boolean` and `favoriteRank?: number` to `QuickAction` and `QuickActionFrontmatter`. |
| `src/features/quickActions/quickActionParse.ts` | Parse and serialize new fields. |
| `src/utils/frontmatter.ts` | Add `extractBoolean` and `extractNumber` helpers if absent. |
| `src/features/quickActions/QuickActionStorage.ts` | Add `assignNextFavoriteRank`, `setFavorite`, `unsetFavorite`. |
| `src/features/quickActions/ui/QuickActionsModal.ts` | Star button per row, sort favs first, limit notice. |
| `src/features/quickActions/openContextMenuQuickAction.ts` | Delegate to `runQuickActionForFile`. |
| `src/app/commands/registerWorkspaceMenus.ts` | Inject favorite menu items above the existing "Quick action…" entry. |
| `src/main.ts` (or wiring layer) | Construct the cache at plugin load, dispose at unload. |
| `src/i18n/types.ts` and `src/i18n/locales/*.json` | New keys: `quickActions.modal.markFavorite`, `quickActions.modal.unmarkFavorite`, `quickActions.modal.favoriteLimitReached`. |

### Edge cases

| Case | Behavior |
|------|----------|
| Sixth star click | `assignNextFavoriteRank` returns `null`. `Notice` shown. No write. Star stays outline. |
| Two files claim the same rank (manual edit) | Load-time sort by `(rank, name)` gives stable display. No automatic rewrite. Collision persists until the user unstars one of the colliding actions; the next star event then assigns the lowest unused rank via `assignNextFavoriteRank` and the collision clears. |
| `favoriteRank` outside `1..5` | Treated as unset slot at parse time. Action shown after compliant favorites in load order. |
| `favorite: true` with no `favoriteRank` | Auto-assigned on next save. Until then, shown at the end of the favorites group. |
| `favoriteRank` set, `favorite` missing or `false` | Rank ignored; action is not a favorite. |
| Quick-action file renamed | Frontmatter travels with the file. Cache `rename` handler reloads. Menu reflects the new name on next open. |
| Quick-action file deleted | Cache `delete` handler drops it. Slot becomes free. |
| `quickActionsFolder` setting changed | Cache resubscribes to the new folder and reloads. Events for the old folder are ignored. |
| Cold cache during right-click | Menu shows zero favorites that turn — only the existing "Quick action…" entry. Subsequent right-clicks after load show favs. No blocking. |
| External edit while modal is open | Modal already calls `refreshList` after its own saves. External edits surface on next modal open. Acceptable. |
| Save error during star toggle | Existing `QuickActionStorage.save` failure path applies. Modal surfaces the same notice it uses today for save failures. Star reverts to its prior state. |

## Testing

Specs mirror under `tests/unit/features/quickActions/`.

| Spec | Coverage |
|------|----------|
| `quickActionParse.favorite.test.ts` | Parse `favorite: true` plus `favoriteRank: N`. Round-trip via serialize. Out-of-range rank treated as unset. Missing or `false` favorite omits both lines on serialize. |
| `QuickActionStorage.favorites.test.ts` | `assignNextFavoriteRank` returns 1 through 5 then `null`. `setFavorite` writes both fields. `unsetFavorite` strips them and preserves the prompt body. Gaps preserved. |
| `QuickActionFavoritesCache.test.ts` | Initial load returns favs sorted by rank. `create`, `modify`, `delete`, and `rename` events under `quickActionsFolder` trigger reload. Events outside the folder are ignored. Folder-path change resubscribes. Cold cache returns `[]`. |
| `QuickActionsModal.favorites.test.ts` | Star button renders per row with correct icon state. Click toggles and persists. Sixth star shows the limit notice and skips the write. Sort order: favs by rank, separator, alphabetical rest. Search filter flattens the grouping. |
| `registerWorkspaceMenus.favorites.test.ts` | File menu and folder menu inject `N` favorite items (where `N` is cache size) above the existing "Quick action…" entry. Order matches rank. `onClick` routes through `runQuickActionForFile`. Zero favs renders only the existing entry. |
| `runQuickActionForFile.test.ts` | Extracted flow: open or reuse tab, attach pill (file vs folder), send prompt. Tab-limit notice path preserved. |

The favorites cap is five, so no performance spec is needed. Integration smoke in `tests/integration/main.test.ts` asserts the cache is constructed at load and disposed at unload.

## Open questions

None. All design questions were resolved during brainstorming.
