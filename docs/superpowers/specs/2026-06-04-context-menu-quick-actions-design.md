---
title: Context menu quick actions
date: 2026-06-04
status: shipped
scope: features/quickActions, app/commands
parent: "[[Quick Actions]]"
---

# Context menu quick actions

## Revision 2026-06-04

One bug fix, blank-tab reuse policy preserved:

1. **Pill attach ordering** — bug fix. `switchToTab()` triggers `ConversationController.initializeWelcome()` on a blank tab, which calls `FileContextManager.resetForNewConversation()` and wipes any pill attached before the switch. Attach must happen AFTER the switch resolves.
2. **One code path** — always call `await switchToTab(targetTab.id)` regardless of whether the target was reused or newly created. `initializeWelcome` runs first (auto-attaches the active note), then the quick-action pill stacks on top. Smallest blast radius — no self-switch guard, no branching ordering rules. Trade-off: any manual pills the user already attached to a blank active tab are wiped by the reset; acceptable for simplicity since the user just invoked an explicit quick-action targeting a different file/folder.

Idea doc ([[As a user I want to start a new chat by right-clicking a file or folder and select a quick-action]]) wording "starts a new chat if one is available" is interpreted as "use a free tab slot when possible" — blank-active reuse satisfies this without forcing a new tab when one already sits empty (avoids hitting the tab limit needlessly).

Tests and pseudocode updated below.

## Problem

Users can run quick actions from the chat toolbar, but there is no way to kick off a quick action directly from a file or folder in the vault file tree. The workflow today requires opening a chat, adding context manually, then opening the quick actions modal. Three steps instead of one.

## Goal

Right-clicking a file or folder in the Obsidian file tree exposes a "Quick actions" context menu item. Selecting it opens the existing quick actions picker modal. When the user picks an action, a new chat tab opens, the file or folder is attached as a visible chip, and the prompt fires immediately.

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
   a. Ensures `ClaudianView` is open (`plugin.getView()` → `plugin.activateView()` fallback).
   b. Gets `TabManager` from the view.
   c. Resolves the target tab (reuse blank active | create new | bail Notice).
   d. `await tabManager.switchToTab(targetTab.id)` — always called, regardless of reuse vs new.
   e. Attaches file or folder chip to the target tab's `fileContextManager`.
   f. Calls `targetTab.controllers.inputController?.sendMessage({ content: action.prompt })`.

### Target tab selection

```
activeTab = tabManager.getActiveTab()
isBlank = activeTab && activeTab.lifecycleState === 'blank'

if (isBlank):
  targetTab = activeTab           // reuse blank active tab
else if (tabManager.canCreateTab()):
  targetTab = await tabManager.createTab(null, undefined, { activate: false })
  if (!targetTab):
    Notice(t('quickActions.contextMenu.tabLimitReached'))
    return
else:
  Notice(t('quickActions.contextMenu.tabLimitReached'))
  return
```

### Switch + attach (ordering critical)

```typescript
await tabManager.switchToTab(targetTab.id);  // triggers initializeWelcome → resetForNewConversation on blank tabs

if (file instanceof TFile) {
  targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
} else if (file instanceof TFolder) {
  targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
}
```

Order matters. `switchToTab` on a blank tab triggers `ConversationController.initializeWelcome()` which calls `FileContextManager.resetForNewConversation()`. Attaching the pill BEFORE the switch loses it; attach after the switch resolves.

One code path: `switchToTab` runs even when targetTab is the active blank tab. `initializeWelcome` will re-fire and any prior manual pills are wiped, but the quick-action pill is always attached cleanly afterwards. Avoids self-switch guard branching and keeps behaviour identical between reuse and new-tab paths.

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
| Blank active tab (`lifecycleState === 'blank'`) | `createTab` not called; `switchToTab` called with activeTab.id; `attachFileAsPill` called on activeTab |
| Active tab has conversation (`lifecycleState !== 'blank'`) | `createTab` called; `switchToTab` called with new tab id |
| Tab limit reached (`canCreateTab() = false` and no blank active) | `Notice` shown with `quickActions.contextMenu.tabLimitReached`, `createTab` not called, `sendMessage` not called |
| `createTab` returns null | `Notice` shown, `sendMessage` not called |
| `TFile` context | `attachFileAsPill(file.path)` called on target tab's FCM |
| `TFolder` context | `attachFolderAsPill(folder.path)` called on target tab's FCM |
| Attach happens AFTER switch (both paths) | `switchToTab.mock.invocationCallOrder[0] < attachFileAsPill.mock.invocationCallOrder[0]` — regression guard against the `initializeWelcome` reset wiping the pill |
| Happy path send | `sendMessage({ content: action.prompt })` called on target inputController |

## Out of scope

- Folder-only or file-only filter on the quick action definition itself.
- Running multiple actions at once from the context menu.
- Pre-filling the composer instead of sending immediately.
