---
status: done
parent: Cross Cutting
---
# Right-click Menu Quick Actions Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder and rename Claudian right-click menu entries so workspace menus are separator-bracketed and both workspace plus Agent Board quick-action blocks open the picker before favorites.

**Architecture:** Keep one shared quick-action menu helper for picker/favorite ordering. Workspace file/folder menus own only their leading/trailing separators and primary actions. Agent Board keeps its existing action gates and inherits the shared picker-before-favorites layout.

**Tech Stack:** TypeScript, Obsidian `Menu`, Jest unit/integration tests, existing i18n JSON files.

---

## File Structure

- Modify `src/features/quickActions/appendQuickActionMenu.ts`: append picker first, then cached favorites; update comments to match behavior.
- Modify `src/app/commands/registerWorkspaceMenus.ts`: add a separator before and after Claudian's file/folder menu block.
- Modify `src/i18n/locales/en.json`: set `quickActions.contextMenu.title` to `Open Quick Actions`.
- Modify `tests/unit/app/commands/registerWorkspaceMenus.test.ts`: update menu mock to capture separators and assert workspace order.
- Modify `tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts`: update expected Agent Board order and click indices.
- Modify `tests/integration/main.test.ts`: update integration expectations for separators/order/title.

### Task 1: Workspace Menu Tests

**Files:**
- Modify: `tests/unit/app/commands/registerWorkspaceMenus.test.ts`

- [ ] **Step 1: Write failing workspace menu tests**

Update the menu mock to support `addSeparator`, expose `MENU_SEPARATOR`, and change expectations so a file with two favorites produces:

```ts
[
  '<sep>',
  'Add file to Claudian chat',
  'Create work order',
  'Open Quick Actions',
  'Refactor',
  'Summarize',
  '<sep>',
]
```

For folders without favorites, expect:

```ts
[
  '<sep>',
  'Add folder to Claudian chat',
  'Create work order',
  'Open Quick Actions',
  '<sep>',
]
```

Update the i18n mock map:

```ts
'quickActions.contextMenu.title': 'Open Quick Actions'
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run test -- --runTestsByPath tests/unit/app/commands/registerWorkspaceMenus.test.ts
```

Expected: FAIL because production code does not add separators and still appends favorites before the picker.

- [ ] **Step 3: Stop before production changes**

Do not modify production code until the RED failure is observed.

### Task 2: Shared Helper and Workspace Menu Implementation

**Files:**
- Modify: `src/features/quickActions/appendQuickActionMenu.ts`
- Modify: `src/app/commands/registerWorkspaceMenus.ts`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: Implement minimal production change**

Change `appendQuickActionFavoritesAndPicker` to add the picker item first:

```ts
menu.addItem((item) => item
  .setTitle(t('quickActions.contextMenu.title'))
  .setIcon('zap')
  .onClick(() => { openContextMenuQuickAction(plugin, file); }));

const favs = plugin.quickActionFavoritesCache?.getFavorites() ?? [];
for (const fav of favs) {
  menu.addItem((item) => item
    .setTitle(fav.name)
    .setIcon(fav.icon ?? 'star')
    .onClick(() => { void runQuickActionForFile(plugin, file, fav); }));
}
```

In each `TFile` and `TFolder` branch of `registerWorkspaceMenus`, call `menu.addSeparator()` before the first Claudian item and after `appendQuickActionFavoritesAndPicker(menu, plugin, file)`.

Set the English context-menu title in `src/i18n/locales/en.json`:

```json
"title": "Open Quick Actions"
```

- [ ] **Step 2: Verify GREEN for workspace tests**

Run:

```bash
npm run test -- --runTestsByPath tests/unit/app/commands/registerWorkspaceMenus.test.ts
```

Expected: PASS.

### Task 3: Agent Board Tests

**Files:**
- Modify: `tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts`

- [ ] **Step 1: Write/update Agent Board expectations**

Update full-menu expected titles to place the picker before favorites:

```ts
[
  'tasks.board.contextMenu.openNote',
  'tasks.board.contextMenu.openConversation',
  '<sep>',
  'quickActions.contextMenu.title',
  'Fav A',
  'Fav B',
]
```

Update click indices:

```ts
// favorite is index 3 when there is one favorite and no picker? No: index 2 is separator, index 3 is picker, index 4 is Fav A.
const favItem = menu.items[4] as { clickHandler?: () => void };

// picker is index 2 when there are no favorites: index 0 Open note, index 1 separator, index 2 picker.
const pickerItem = menu.items[2] as { clickHandler?: () => void };
```

- [ ] **Step 2: Verify Agent Board tests**

Run:

```bash
npm run test -- --runTestsByPath tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts
```

Expected: PASS after Task 2 implementation; if run before Task 2, it fails because helper order has not changed.

### Task 4: Integration Test Updates

**Files:**
- Modify: `tests/integration/main.test.ts`

- [ ] **Step 1: Update integration expectations**

Use the mock menu separator symbol already exposed by `tests/__mocks__/obsidian.ts` or compare only non-separator entries where appropriate. For file and folder menus, assert the first entry is a separator, the last entry is a separator, and the item titles/icons in between match:

```ts
[
  'Add file to Claudian chat',
  'Create work order',
  'Open Quick Actions',
]
```

and

```ts
[
  'Add folder to Claudian chat',
  'Create work order',
  'Open Quick Actions',
]
```

- [ ] **Step 2: Verify integration tests**

Run:

```bash
npm run test -- --runTestsByPath tests/integration/main.test.ts
```

Expected: PASS.

### Task 5: Final Verification and Commit

**Files:**
- All modified files above.

- [ ] **Step 1: Run targeted verification**

Run:

```bash
npm run test -- --runTestsByPath tests/unit/app/commands/registerWorkspaceMenus.test.ts tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts tests/integration/main.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-05-right-click-menu-overhaul-design.md docs/superpowers/plans/2026-06-05-right-click-menu-overhaul.md src/features/quickActions/appendQuickActionMenu.ts src/app/commands/registerWorkspaceMenus.ts src/i18n/locales/en.json tests/unit/app/commands/registerWorkspaceMenus.test.ts tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts tests/integration/main.test.ts
git commit -m "feat: overhaul Claudian right-click menu order"
```
