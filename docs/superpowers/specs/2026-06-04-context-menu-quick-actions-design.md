---
title: "Context menu quick actions"
date: 2026-06-04
status: approved
scope: features/quickActions, app/commands
---

# Context menu quick actions

## Problem

Users can run quick actions from the chat toolbar, but there is no way to kick off a quick action directly from a file or folder in the vault file tree. The workflow today requires opening a chat, adding context manually, then opening the quick actions modal. Three steps instead of one.

## Goal

Right-clicking a file or folder in the Obsidian file tree exposes a "Quick actions" context menu item. Selecting it opens the existing quick actions picker modal. When the user picks an action, the file or folder is attached as a visible chip and the prompt fires immediately in a suitable chat tab.

## Design

### New file: `src/features/quickActions/openContextMenuQuickAction.ts`

Exports one function:

```typescript
export async function openContextMenuQuickAction(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): Promise<void>
```

**Responsibilities:**

1. Instantiates `QuickActionStorage` using `plugin.settings.quickActionsFolder`.
2. Opens `QuickActionsModal` with an `onRun` callback.
3. `onRun(action)`:
   a. Calls `plugin.ensureViewOpen()` to get the `ClaudianView`.
   b. Gets `TabManager` from the view.
   c. Selects the target tab (see logic below).
   d. Attaches file or folder chip to the target tab's `fileContextManager`.
   e. Calls `tabManager.switchToTab(targetTab.id)`.
   f. Calls `targetTab.controllers.inputController?.sendMessage({ content: action.prompt })`.

### Target tab selection

```
const activeTab = tabManager.getActiveTab()
const isBlank = activeTab && activeTab.lifecycleState === 'blank'

if (isBlank):
  targetTab = activeTab           // reuse blank tab

else if (tabManager.canCreateTab()):
  targetTab = await tabManager.createTab(null, undefined, { activate: false })
  if (!targetTab):
    Notice(t('quickActions.contextMenu.tabLimitReached'))
    return

else:
  Notice(t('quickActions.contextMenu.tabLimitReached'))
  return
```

### Chip injection

```typescript
if (file instanceof TFile) {
  targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
} else if (file instanceof TFolder) {
  targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
}
```

If `fileContextManager` is null (tab not yet UI-initialized), chip is skipped and the send still fires — graceful degradation.

### Changes to `src/app/commands/registerWorkspaceMenus.ts`

Add one import:

```typescript
import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
```

Add one `menu.addItem` block inside the `TFile` branch and one inside the `TFolder` branch:

```typescript
menu.addItem((item) => {
  item
    .setTitle(t('quickActions.contextMenu.title'))
    .setIcon('zap')
    .onClick(() => void openContextMenuQuickAction(plugin, file));
});
```

### i18n

New key added to all 10 locale files under `quickActions.contextMenu`:

| Key | English value |
|-----|---------------|
| `quickActions.contextMenu.title` | `"Quick actions"` |
| `quickActions.contextMenu.tabLimitReached` | `"Cannot open quick action: tab limit reached. Close a tab first."` |

All other locales get the same English string initially; translators update on next pass.

## Error handling

| Situation | Behavior |
|-----------|----------|
| Tab limit reached | `Notice` using new key `quickActions.contextMenu.tabLimitReached` |
| `ensureViewOpen()` returns null | Bail silently — Obsidian failed to open the view |
| No quick actions defined | Modal renders existing empty-state with "create your first action" hint |
| `fileContextManager` null | Skip chip attachment, proceed with send |

## Tests

File: `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`

| Test | Assertion |
|------|-----------|
| Blank active tab (`lifecycleState === 'blank'`) | `targetTab === activeTab` — existing tab is reused |
| Active tab has conversation (`lifecycleState !== 'blank'`) | `createTab` called, new tab used |
| Tab limit reached (`canCreateTab() = false`) | `Notice` shown, `sendMessage` not called |
| `TFile` context | `attachFileAsPill(file.path)` called on target tab's FCM |
| `TFolder` context | `attachFolderAsPill(folder.path)` called on target tab's FCM |
| Happy path send | `sendMessage({ content: action.prompt })` called on target inputController |

## Out of scope

- Folder-only or file-only filter on the quick action definition itself.
- Running multiple actions at once from the context menu.
- Pre-filling the composer instead of sending immediately.
