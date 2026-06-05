---
title: Work-order card right-click quick actions
date: 2026-06-05
status: implemented
scope: features/tasks/ui, features/quickActions, i18n
parent: "[[Agent Kanban Board]]"
relations:
  - "[[2026-06-04-context-menu-quick-actions-design]]"
  - "[[2026-06-04-quick-action-favorites-design]]"
---

# Work-order card right-click quick actions

## Problem

Agent Board cards expose state-transition buttons (Mark ready, Run, Stop, Accept, Rework, Reopen) and open the detail modal on left-click. There is no way to fire a vault quick-action against a work order from the board. Today the user must open the WO note in a tab, then right-click that file in the vault explorer to reach favorites and the picker. Two extra steps per quick action.

The idea note `docs/ideas/As a User I want to have right-click quick-actions available on not-running Work-Orders.md` asks for a right-click context menu on board cards that exposes quick actions, gated to non-running work orders.

## Goal

Right-clicking a work-order card on the Agent Board opens an Obsidian `Menu` with:

- `Open note`, `Open conversation` (read-only navigation, always available when applicable).
- `Quick action` favorites + a `Quick actions…` picker entry that runs the chosen action against the work-order note as an attached pill, hidden while the work order is `running`.

Selecting a quick action reuses the existing `runQuickActionForFile` / `openContextMenuQuickAction` flow: tab resolution, pill attach, prompt send. No new modal sites, no new tab-routing logic.

## Non-goals

- No state-transition entries (Mark ready, Run, Accept, Rework, Reopen, Archive) in the right-click menu. Those stay on the card button row and in the detail modal.
- No changes to the file-menu wiring in `registerWorkspaceMenus.ts`. The board menu is a parallel surface that reuses shared helpers, not a refactor of the existing one.
- No new state-machine transitions or work-order lifecycle changes.
- No new MCP or provider plumbing.
- No mobile-specific affordance beyond what Obsidian's native long-press → `contextmenu` provides.

## Design

### Module boundaries

New file: `src/features/tasks/ui/workOrderContextMenu.ts`.

```ts
export interface WorkOrderContextMenuDeps {
  plugin: ClaudianPlugin;
  onOpenNote: (task: TaskSpec) => void;
  onOpenConversation: (task: TaskSpec) => void;
  canOpenConversation: (task: TaskSpec) => boolean;
}

export function showWorkOrderContextMenu(
  task: TaskSpec,
  event: MouseEvent,
  deps: WorkOrderContextMenuDeps,
): void;
```

Pure function. Builds an Obsidian `Menu`, populates items per gating rules, calls `menu.showAtMouseEvent(event)`. No class state, no caching, no plugin mutation. Returns void.

`AgentBoardRenderCallbacks` gains one field:

```ts
onContextMenu(task: TaskSpec, event: MouseEvent): void;
```

`AgentBoardRenderer.renderCard` binds:

```ts
card.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  callbacks.onContextMenu(task, event);
});
```

`AgentBoardView.render` wires the callback to the helper:

```ts
onContextMenu: (task, event) => showWorkOrderContextMenu(task, event, {
  plugin: this.plugin,
  onOpenNote: (t) => void this.openTask(t),
  onOpenConversation: (t) => {
    const id = t.frontmatter.conversation_id;
    if (id) void this.plugin.openConversation(id);
  },
  canOpenConversation: (t) => {
    const id = t.frontmatter.conversation_id;
    return Boolean(id && this.plugin.getConversationSync(id));
  },
}),
```

Boundary respect:

- Renderer stays plugin-free; only knows the callback shape.
- View owns plugin and `executionSurface` wiring.
- Helper owns Obsidian `Menu` DSL and gating logic.

Mirrors how `WorkOrderDetailModal` is constructed today.

### Menu contents

Items emitted in this order. Separator only when at least one item below it renders. No trailing separator.

| # | Icon | Title | Shown when | Action |
|---|------|-------|------------|--------|
| 1 | `file-text` | `tasks.board.contextMenu.openNote` ("Open note") | always | `onOpenNote(task)` → opens `task.path` in a new tab via existing `AgentBoardView.openTask` (`workspace.getLeaf('tab').openFile(file)`) |
| 2 | `messages-square` | `tasks.board.contextMenu.openConversation` ("Open conversation") | `canOpenConversation(task) === true` | `onOpenConversation(task)` |
| sep | — | separator | favorites or picker shown below | — |
| 3..N | `fav.icon ?? 'star'` | `fav.name` | `status !== 'running'` AND favorites cache non-empty AND WO `TFile` resolvable | `runQuickActionForFile(plugin, woTFile, fav)` |
| N+1 | `zap` | `quickActions.contextMenu.title` ("Quick actions…") | `status !== 'running'` AND WO `TFile` resolvable | `openContextMenuQuickAction(plugin, woTFile)` |

Favorites list comes from `plugin.quickActionFavoritesCache.getFavorites()` — same source the file-menu favorites use, capped at 5 by `MAX_FAVORITES` in the cache. No new subscription, no new cache.

### Gating rules

- **`running` status** → quick-action items dropped. Open note + Open conversation only. Reasoning: avoid surprise side-prompts against an active run from a menu that looks like a normal "fire one off" affordance.
- **`needs_input` / `needs_approval`** → quick-action items SHOWN. These are mid-flight states but the user often needs to prepare a follow-up prompt in a different tab; gating them adds friction without safety benefit. Confirmed in brainstorming Q2 (option A "strict").
- **All other statuses** (`inbox`, `ready`, `review`, `needs_fix`, `done`, `failed`, `canceled`) → quick-action items SHOWN.
- **WO `TFile` unresolvable** (note deleted / moved between board render and right-click) → favorites + picker entries dropped. Open note remains; clicking it falls through `AgentBoardView.openTask`, which silently no-ops when the abstract file is not a `TFile`. A `Notice` is not surfaced today — flag as follow-up if user-facing feedback is desired.
- **No favorites + WO `TFile` resolvable + not running** → only the `Quick actions…` picker entry below the separator. Separator still emitted because picker counts as "items below".
- **Empty menu** (defensive) → don't call `showAtMouseEvent`. Cannot trigger in practice since Open note is unconditional.

### Wiring code sketch

```ts
import { Menu, TFile } from 'obsidian';
import { runQuickActionForFile } from '@/features/quickActions/runQuickActionForFile';
import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
import { t } from '@/i18n/i18n';
import type { TaskSpec } from '../model/taskTypes';
import type ClaudianPlugin from '@/main';

export interface WorkOrderContextMenuDeps {
  plugin: ClaudianPlugin;
  onOpenNote: (task: TaskSpec) => void;
  onOpenConversation: (task: TaskSpec) => void;
  canOpenConversation: (task: TaskSpec) => boolean;
}

export function showWorkOrderContextMenu(
  task: TaskSpec,
  event: MouseEvent,
  deps: WorkOrderContextMenuDeps,
): void {
  const { plugin, onOpenNote, onOpenConversation, canOpenConversation } = deps;
  const menu = new Menu();

  menu.addItem((i) => i
    .setTitle(t('tasks.board.contextMenu.openNote'))
    .setIcon('file-text')
    .onClick(() => onOpenNote(task)));

  if (canOpenConversation(task)) {
    menu.addItem((i) => i
      .setTitle(t('tasks.board.contextMenu.openConversation'))
      .setIcon('messages-square')
      .onClick(() => onOpenConversation(task)));
  }

  const isRunning = task.frontmatter.status === 'running';
  const abstract = plugin.app.vault.getAbstractFileByPath(task.path);
  const woTFile = abstract instanceof TFile ? abstract : null;
  const canPromptOn = !isRunning && woTFile !== null;

  if (canPromptOn) {
    const favs = plugin.quickActionFavoritesCache?.getFavorites() ?? [];
    menu.addSeparator();
    for (const fav of favs) {
      menu.addItem((i) => i
        .setTitle(fav.name)
        .setIcon(fav.icon ?? 'star')
        .onClick(() => { void runQuickActionForFile(plugin, woTFile, fav); }));
    }
    menu.addItem((i) => i
      .setTitle(t('quickActions.contextMenu.title'))
      .setIcon('zap')
      .onClick(() => openContextMenuQuickAction(plugin, woTFile)));
  }

  menu.showAtMouseEvent(event);
}
```

Renderer edit, inside `AgentBoardRenderer.renderCard` after the existing `card.addEventListener('click', ...)`:

```ts
card.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  callbacks.onContextMenu(task, event);
});
```

View edit, inside the `this.renderer.render(...)` callbacks bag in `AgentBoardView.render`:

```ts
onContextMenu: (task, event) => showWorkOrderContextMenu(task, event, {
  plugin: this.plugin,
  onOpenNote: (t) => void this.openTask(t),
  onOpenConversation: (t) => {
    const id = t.frontmatter.conversation_id;
    if (id) void this.plugin.openConversation(id);
  },
  canOpenConversation: (t) => {
    const id = t.frontmatter.conversation_id;
    return Boolean(id && this.plugin.getConversationSync(id));
  },
}),
```

Click handler unchanged — left-click still opens the detail modal. Right-click is additive.

### What does NOT change

- `QuickActionFavoritesCache` — already plugin-lifetime, already syncs to `quickActionsFolder` vault events.
- `runQuickActionForFile` — handles tab routing (blank reuse, new tab if needed, tab-limit notice), pill attach (file vs folder), prompt send. Same code path the existing file-menu favorites already use.
- `openContextMenuQuickAction` — opens the existing picker modal pre-bound to the file argument.
- Task state machine, indexer, run coordinator, prompt renderer, ledger / handoff writes.
- File menu (`registerWorkspaceMenus.ts`) entries — untouched.

### i18n

New keys:

- `tasks.board.contextMenu.openNote` → "Open note"
- `tasks.board.contextMenu.openConversation` → "Open conversation"

Add to all 10 locale files under `src/i18n/locales/`. Reuse existing `quickActions.contextMenu.title` for the picker entry (already translated).

### CSS

No new selectors. Card visual stays identical; only event behavior changes.

## Edge cases

| Case | Behavior |
|------|----------|
| Right-click on an inline card action button (`Run`, `Stop`, …) | Browser fires `contextmenu` on the button; event bubbles to the card listener; same menu shows. Buttons themselves have no native menu. Acceptable. |
| WO note deleted between render and right-click | `getAbstractFileByPath` returns null → quick-action items dropped. Open note still listed; clicking it falls through `AgentBoardView.openTask`, which silently no-ops (no `Notice`). |
| `conversation_id` set but conversation missing from store | `canOpenConversation` returns false → item hidden. Matches detail modal logic. |
| Favorites cache not yet started (modal opened before `completeDeferredOnload`) | `getFavorites()` returns `[]` → no favorites shown, picker still works. |
| Esc / outside click while menu open | Obsidian `Menu` closes itself. No leak. |
| Touch / long-press on mobile | Obsidian fires `contextmenu` on long-press; same behavior. No mobile-specific wiring. |
| Rapid repeated right-clicks | Each shows its own menu; Obsidian closes the previous one. No accumulation. |
| Status `running` AND user right-clicks anyway | Quick-action items hidden. Open note + Open conversation only. |
| `event.preventDefault()` omitted | Native browser menu could co-trigger. Renderer listener always calls `preventDefault`. |
| Pill attach race (WO note deleted between right-click and `runQuickActionForFile`) | `attachFileAsPill(path)` is best-effort in the existing flow; no new handling needed. |
| WO note renamed between render and right-click | `task.path` stale → resolves to null → quick-action items dropped. Board's `rename` listener refreshes shortly after. |
| `container.empty()` on re-render | Discards old DOM and its listeners; no listener accumulation across refreshes. |

## Tests

All under `tests/unit/features/tasks/ui/` mirroring `src/`.

### `workOrderContextMenu.test.ts` — new

Mock Obsidian `Menu` to record `addItem` / `addSeparator` / `showAtMouseEvent` calls. Mock `TFile`, `vault.getAbstractFileByPath`, `runQuickActionForFile`, `openContextMenuQuickAction`, `plugin.quickActionFavoritesCache`.

| # | Setup | Expected items |
|---|-------|----------------|
| 1 | status `ready`, conv exists, 2 favs, WO TFile resolvable | Open note, Open conversation, sep, fav1, fav2, Quick actions… |
| 2 | status `ready`, no conv, no favs, WO TFile resolvable | Open note, sep, Quick actions… |
| 3 | status `running`, conv exists, 3 favs | Open note, Open conversation |
| 4 | status `running`, no conv | Open note |
| 5 | status `needs_input`, no conv, 2 favs, WO TFile resolvable | Open note, sep, fav1, fav2, Quick actions… |
| 6 | status `needs_approval`, no conv, 1 fav, WO TFile resolvable | Open note, sep, fav1, Quick actions… |
| 7 | WO TFile unresolvable, status `ready`, conv exists | Open note, Open conversation |
| 8 | `quickActionFavoritesCache` undefined, status `ready`, WO TFile resolvable | Open note, sep, Quick actions… |
| 9 | `conversation_id` set but `canOpenConversation` false | Open conversation hidden |
| 10 | Click favorite item | `runQuickActionForFile(plugin, woTFile, fav)` called with exact args |
| 11 | Click picker item | `openContextMenuQuickAction(plugin, woTFile)` called with exact args |
| 12 | All paths | `showAtMouseEvent(event)` called exactly once at the end |

### `AgentBoardRenderer.test.ts` — augment

- Card has a `contextmenu` listener.
- Firing `contextmenu` event calls `callbacks.onContextMenu(task, event)`.
- `event.preventDefault()` invoked.
- Existing left-click behavior (`onOpenDetail`) unchanged.

### Integration

None required. `AgentBoardView` integration tests already cover the render flow. The menu helper is fully unit-testable.

## Open questions

None.

## Rollout

1. Land helper module + renderer/view edits + tests.
2. Add i18n keys to all 10 locales.
3. Run `npm run typecheck && npm run lint && npm run test && npm run build`.
4. Smoke-test in the cursor fork build (per `claudian-dev-build-setup` memory): right-click a card in each lane, including `running`, `needs_input`, `needs_approval`.
5. Mark idea note status `done` and link this spec.
