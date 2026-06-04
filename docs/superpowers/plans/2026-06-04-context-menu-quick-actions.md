# Context Menu Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-clicking a file or folder in the Obsidian file tree surfaces a "Quick actions" menu item that opens the existing quick actions picker, then fires the selected action in an appropriate chat tab with the file/folder attached as a visible chip.

**Architecture:** A new `openContextMenuQuickAction` helper in `src/features/quickActions/` owns the full flow: modal open → tab selection (reuse blank or create new) → chip injection → immediate send. `registerWorkspaceMenus.ts` calls this helper from the `file-menu` handler — it stays thin.

**Tech Stack:** TypeScript, Obsidian Plugin API (Menu, TFile, TFolder, Notice), Jest, existing `QuickActionsModal`, `QuickActionStorage`, `TabManager`, `FileContextManager`.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/features/quickActions/openContextMenuQuickAction.ts` | Core flow function |
| Modify | `src/app/commands/registerWorkspaceMenus.ts` | Add Quick Actions menu items |
| Modify | `src/i18n/types.ts` | Add 2 new i18n key types |
| Modify | `src/i18n/locales/en.json` | Add English strings |
| Modify | `src/i18n/locales/de.json` | Add strings (English copy) |
| Modify | `src/i18n/locales/es.json` | Add strings (English copy) |
| Modify | `src/i18n/locales/fr.json` | Add strings (English copy) |
| Modify | `src/i18n/locales/ja.json` | Add strings (English copy) |
| Modify | `src/i18n/locales/ko.json` | Add strings (English copy) |
| Modify | `src/i18n/locales/pt.json` | Add strings (English copy) |
| Modify | `src/i18n/locales/ru.json` | Add strings (English copy) |
| Modify | `src/i18n/locales/zh-CN.json` | Add strings (English copy) |
| Modify | `src/i18n/locales/zh-TW.json` | Add strings (English copy) |
| Create | `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts` | Unit tests |
| Modify | `tests/unit/app/commands/registerWorkspaceMenus.test.ts` | Update item-count assertions |

---

## Task 1: i18n keys

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/de.json`
- Modify: `src/i18n/locales/es.json`
- Modify: `src/i18n/locales/fr.json`
- Modify: `src/i18n/locales/ja.json`
- Modify: `src/i18n/locales/ko.json`
- Modify: `src/i18n/locales/pt.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Add type literals to `src/i18n/types.ts`**

Find the block that contains `'quickActions.toolbar.ariaLabel'` and add two new lines after the existing `quickActions.*` entries (before the next comment block):

```typescript
  | 'quickActions.contextMenu.title'
  | 'quickActions.contextMenu.tabLimitReached'
```

The full region should look like:

```typescript
  // Quick Actions
  | 'quickActions.toolbar.ariaLabel'
  | 'quickActions.toolbar.title'
  | 'quickActions.modal.title'
  // ... (existing lines unchanged) ...
  | 'quickActions.editor.saveFailed'
  | 'quickActions.contextMenu.title'
  | 'quickActions.contextMenu.tabLimitReached'
```

- [ ] **Step 2: Add strings to `src/i18n/locales/en.json`**

Find `"quickActions": {` and add a `"contextMenu"` section after the `"editor"` block closes. The `quickActions` object should end like:

```json
    "editor": {
      "titleEdit": "Edit quick action",
      "titleAdd": "Add quick action",
      "name": "Name",
      "nameDesc": "Used as the filename (cannot change when editing)",
      "description": "Description",
      "icon": "Icon",
      "iconDesc": "Optional icon shown in the quick actions list",
      "iconSearch": "Search icons…",
      "iconNone": "No icon",
      "iconNoResults": "No matching icons",
      "prompt": "Prompt",
      "promptDesc": "Message sent to the chat when you run this action",
      "nameRequired": "Name is required",
      "promptRequired": "Prompt is required",
      "saveFailed": "Failed to save quick action"
    },
    "contextMenu": {
      "title": "Quick actions",
      "tabLimitReached": "Cannot open quick action: tab limit reached. Close a tab first."
    }
```

- [ ] **Step 3: Add the same `"contextMenu"` block to all 9 non-English locale files**

For each of the following files, find `"quickActions": {` → navigate to the end of the `"editor"` block → add the same JSON after the closing `}` of `"editor"`:

```json
    "contextMenu": {
      "title": "Quick actions",
      "tabLimitReached": "Cannot open quick action: tab limit reached. Close a tab first."
    }
```

Files to update:
- `src/i18n/locales/de.json`
- `src/i18n/locales/es.json`
- `src/i18n/locales/fr.json`
- `src/i18n/locales/ja.json`
- `src/i18n/locales/ko.json`
- `src/i18n/locales/pt.json`
- `src/i18n/locales/ru.json`
- `src/i18n/locales/zh-CN.json`
- `src/i18n/locales/zh-TW.json`

- [ ] **Step 4: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/types.ts src/i18n/locales/
git commit -m "i18n: add contextMenu keys for quick actions context menu"
```

---

## Task 2: Write failing tests for `openContextMenuQuickAction`

**Files:**
- Create: `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { Notice, TFile, TFolder } from 'obsidian';

import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
import type { QuickAction } from '@/features/quickActions/types';

// ---- Mocks ----------------------------------------------------------------

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

jest.mock('@/core/storage/VaultFileAdapter', () => ({
  VaultFileAdapter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@/features/quickActions/QuickActionStorage', () => ({
  QuickActionStorage: jest.fn().mockImplementation(() => ({})),
}));

// Capture the onRun callback passed to QuickActionsModal so tests can invoke it.
let capturedOnRun: ((action: QuickAction) => void) | null = null;

jest.mock('@/features/quickActions/ui/QuickActionsModal', () => ({
  QuickActionsModal: jest.fn().mockImplementation((_app: unknown, callbacks: { onRun: (action: QuickAction) => void }) => {
    capturedOnRun = callbacks.onRun;
    return { open: jest.fn() };
  }),
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

// ---- Helpers ---------------------------------------------------------------

const MOCK_ACTION: QuickAction = {
  id: 'act-1',
  name: 'Summarize',
  description: 'Summarize the note',
  prompt: 'Summarize this.',
  filePath: 'Quick Actions/summarize.md',
};

function makeMockTab(lifecycleState: 'blank' | 'bound_cold' | 'active') {
  return {
    id: 'tab-1',
    lifecycleState,
    ui: {
      fileContextManager: {
        attachFileAsPill: jest.fn(),
        attachFolderAsPill: jest.fn(),
      },
    },
    controllers: {
      inputController: {
        sendMessage: jest.fn(),
      },
    },
  };
}

function makeMockTabManager(opts: {
  activeTab: ReturnType<typeof makeMockTab> | null;
  canCreate: boolean;
  newTab?: ReturnType<typeof makeMockTab> | null;
}) {
  return {
    getActiveTab: jest.fn(() => opts.activeTab),
    canCreateTab: jest.fn(() => opts.canCreate),
    createTab: jest.fn().mockResolvedValue(opts.newTab ?? null),
    switchToTab: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockPlugin(
  tabManager: ReturnType<typeof makeMockTabManager> | null,
  viewExists = true,
) {
  const view = viewExists
    ? { getTabManager: jest.fn(() => tabManager) }
    : null;

  return {
    app: { vault: {} },
    settings: { quickActionsFolder: 'Quick Actions' },
    getView: jest.fn(() => view),
    activateView: jest.fn().mockResolvedValue(undefined),
  };
}

// ---- Tests -----------------------------------------------------------------

beforeEach(() => {
  capturedOnRun = null;
  jest.clearAllMocks();
});

describe('openContextMenuQuickAction', () => {
  it('opens QuickActionsModal', async () => {
    const activeTab = makeMockTab('blank');
    const tabManager = makeMockTabManager({ activeTab, canCreate: true });
    const plugin = makeMockPlugin(tabManager);

    await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);

    const { QuickActionsModal } = jest.requireMock('@/features/quickActions/ui/QuickActionsModal');
    expect(QuickActionsModal).toHaveBeenCalledTimes(1);
  });

  describe('onRun tab selection', () => {
    it('reuses blank active tab', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      await capturedOnRun!(MOCK_ACTION);

      expect(tabManager.createTab).not.toHaveBeenCalled();
      expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-1');
    });

    it('creates new tab when active tab has a conversation', async () => {
      const activeTab = makeMockTab('active');
      const newTab = makeMockTab('blank');
      newTab.id = 'tab-2';
      const tabManager = makeMockTabManager({ activeTab, canCreate: true, newTab });
      const plugin = makeMockPlugin(tabManager);

      await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      await capturedOnRun!(MOCK_ACTION);

      expect(tabManager.createTab).toHaveBeenCalledWith(null, undefined, { activate: false });
      expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-2');
    });

    it('shows Notice and aborts when canCreateTab is false', async () => {
      const activeTab = makeMockTab('active');
      const tabManager = makeMockTabManager({ activeTab, canCreate: false });
      const plugin = makeMockPlugin(tabManager);

      await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      await capturedOnRun!(MOCK_ACTION);

      expect(Notice).toHaveBeenCalledWith('quickActions.contextMenu.tabLimitReached');
      expect(tabManager.switchToTab).not.toHaveBeenCalled();
    });

    it('shows Notice and aborts when createTab returns null', async () => {
      const activeTab = makeMockTab('active');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true, newTab: null });
      const plugin = makeMockPlugin(tabManager);

      await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      await capturedOnRun!(MOCK_ACTION);

      expect(Notice).toHaveBeenCalledWith('quickActions.contextMenu.tabLimitReached');
      expect(tabManager.switchToTab).not.toHaveBeenCalled();
    });
  });

  describe('onRun chip injection', () => {
    it('attaches file pill for TFile', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      const file = Object.assign(Object.create(TFile.prototype), { path: 'docs/my-note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);

      expect(activeTab.ui.fileContextManager.attachFileAsPill).toHaveBeenCalledWith('docs/my-note.md');
      expect(activeTab.ui.fileContextManager.attachFolderAsPill).not.toHaveBeenCalled();
    });

    it('attaches folder pill for TFolder', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      const folder = Object.assign(Object.create(TFolder.prototype), { path: 'docs' });
      await openContextMenuQuickAction(plugin as any, folder);
      await capturedOnRun!(MOCK_ACTION);

      expect(activeTab.ui.fileContextManager.attachFolderAsPill).toHaveBeenCalledWith('docs');
      expect(activeTab.ui.fileContextManager.attachFileAsPill).not.toHaveBeenCalled();
    });
  });

  describe('onRun send', () => {
    it('calls sendMessage with action prompt', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);

      expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
        content: 'Summarize this.',
      });
    });
  });

  describe('onRun view handling', () => {
    it('calls activateView when view is not yet open', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });

      // getView() returns null on first call, then the view on second call
      const view = { getTabManager: jest.fn(() => tabManager) };
      const plugin = {
        app: { vault: {} },
        settings: { quickActionsFolder: 'Quick Actions' },
        getView: jest.fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(view),
        activateView: jest.fn().mockResolvedValue(undefined),
      };

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);

      expect(plugin.activateView).toHaveBeenCalledTimes(1);
      expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalled();
    });

    it('aborts gracefully when view cannot be opened', async () => {
      const plugin = {
        app: { vault: {} },
        settings: { quickActionsFolder: 'Quick Actions' },
        getView: jest.fn().mockReturnValue(null),
        activateView: jest.fn().mockResolvedValue(undefined),
      };

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);

      // No error thrown, no send attempted
      expect(Notice).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail correctly**

```bash
npm run test -- --selectProjects unit --testPathPattern="openContextMenuQuickAction" --no-coverage
```

Expected: FAIL with `Cannot find module '@/features/quickActions/openContextMenuQuickAction'`

---

## Task 3: Implement `openContextMenuQuickAction`

**Files:**
- Create: `src/features/quickActions/openContextMenuQuickAction.ts`

- [ ] **Step 1: Create the implementation file**

```typescript
import { Notice, TFile, TFolder, type TAbstractFile } from 'obsidian';

import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import { QuickActionStorage } from './QuickActionStorage';
import { QuickActionsModal } from './ui/QuickActionsModal';

/**
 * Opens the quick actions picker modal with the given vault file or folder
 * pre-loaded as context. On action selection: reuses or creates a chat tab,
 * attaches a file chip, then fires the action prompt immediately.
 */
export function openContextMenuQuickAction(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): void {
  const storage = new QuickActionStorage(
    new VaultFileAdapter(plugin.app),
    () => plugin.settings.quickActionsFolder ?? 'Quick Actions',
  );

  new QuickActionsModal(plugin.app, {
    storage,
    onRun: (action) => {
      void (async () => {
        // Ensure the chat view is open; open it if not.
        let view = plugin.getView();
        if (!view) {
          await plugin.activateView();
          view = plugin.getView();
        }
        if (!view) return;

        const tabManager = view.getTabManager();
        if (!tabManager) return;

        // Select target tab: reuse blank tab or create a new one.
        const activeTab = tabManager.getActiveTab();
        const isBlank = activeTab?.lifecycleState === 'blank';
        let targetTab;

        if (isBlank && activeTab) {
          targetTab = activeTab;
        } else if (tabManager.canCreateTab()) {
          const newTab = await tabManager.createTab(null, undefined, { activate: false });
          if (!newTab) {
            new Notice(t('quickActions.contextMenu.tabLimitReached'));
            return;
          }
          targetTab = newTab;
        } else {
          new Notice(t('quickActions.contextMenu.tabLimitReached'));
          return;
        }

        // Attach the right-clicked file or folder as a visible chip.
        if (file instanceof TFile) {
          targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
        } else if (file instanceof TFolder) {
          targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
        }

        // Bring the tab into focus and fire the prompt.
        await tabManager.switchToTab(targetTab.id);
        void targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
      })();
    },
  }).open();
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm run test -- --selectProjects unit --testPathPattern="openContextMenuQuickAction" --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/quickActions/openContextMenuQuickAction.ts \
        tests/unit/features/quickActions/openContextMenuQuickAction.test.ts
git commit -m "feat: add openContextMenuQuickAction helper"
```

---

## Task 4: Wire context menu items and update menu tests

**Files:**
- Modify: `src/app/commands/registerWorkspaceMenus.ts`
- Modify: `tests/unit/app/commands/registerWorkspaceMenus.test.ts`

- [ ] **Step 1: Add import and menu items to `registerWorkspaceMenus.ts`**

Add the import at the top of the file (after the existing imports):

```typescript
import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
```

Inside the `TFile` block, add a third `menu.addItem` call after the existing two:

```typescript
      if (file instanceof TFile) {
        menu.addItem((item) => {
          item
            .setTitle('Add file to Claudian chat')
            .setIcon('at-sign')
            .onClick(() => {
              void plugin.addFileToActiveChat(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Create work order')
            .setIcon('kanban-square')
            .onClick(() => {
              void createWorkOrderInteractive(plugin, file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle(t('quickActions.contextMenu.title'))
            .setIcon('zap')
            .onClick(() => {
              openContextMenuQuickAction(plugin, file);
            });
        });
```

Inside the `TFolder` block, add the same third item:

```typescript
      } else if (file instanceof TFolder) {
        menu.addItem((item) => {
          item
            .setTitle('Add folder to Claudian chat')
            .setIcon('folder')
            .onClick(() => {
              void plugin.addFolderToActiveChat(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Create work order')
            .setIcon('kanban-square')
            .onClick(() => {
              void createWorkOrderInteractive(plugin, file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle(t('quickActions.contextMenu.title'))
            .setIcon('zap')
            .onClick(() => {
              openContextMenuQuickAction(plugin, file);
            });
        });
```

You also need to add the `t` import. Check if it is already imported in the file; if not, add:

```typescript
import { t } from '@/i18n/i18n';
```

- [ ] **Step 2: Update `registerWorkspaceMenus.test.ts` item-count assertions**

The test file currently asserts `toHaveLength(2)` for both `TFile` and `TFolder` branches. Both branches now have 3 items.

Replace:

```typescript
  it('adds Claudian chat + work-order items for TFile entries', () => {
    const { plugin, fileMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);
    expect(items).toHaveLength(2);
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith('Add file to Claudian chat');
    expect((items[1].setTitle as jest.Mock)).toHaveBeenCalledWith('Create work order');
  });
```

With:

```typescript
  it('adds Claudian chat, work-order, and quick-actions items for TFile entries', () => {
    const { plugin, fileMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);
    expect(items).toHaveLength(3);
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith('Add file to Claudian chat');
    expect((items[1].setTitle as jest.Mock)).toHaveBeenCalledWith('Create work order');
    expect((items[2].setTitle as jest.Mock)).toHaveBeenCalledWith('Quick actions');
  });
```

Replace:

```typescript
  it('adds folder + work-order items for TFolder entries', () => {
    const { plugin, fileMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const folder = Object.create(TFolder.prototype) as TFolder;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, folder);
    expect(items).toHaveLength(2);
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith('Add folder to Claudian chat');
    expect((items[1].setTitle as jest.Mock)).toHaveBeenCalledWith('Create work order');
  });
```

With:

```typescript
  it('adds folder, work-order, and quick-actions items for TFolder entries', () => {
    const { plugin, fileMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const folder = Object.create(TFolder.prototype) as TFolder;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, folder);
    expect(items).toHaveLength(3);
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith('Add folder to Claudian chat');
    expect((items[1].setTitle as jest.Mock)).toHaveBeenCalledWith('Create work order');
    expect((items[2].setTitle as jest.Mock)).toHaveBeenCalledWith('Quick actions');
  });
```

The `t` mock: `registerWorkspaceMenus` now calls `t('quickActions.contextMenu.title')`. The test file currently has no `t` mock. Add a module mock at the top of the test file (after the existing imports):

```typescript
jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      'quickActions.contextMenu.title': 'Quick actions',
    };
    return map[key] ?? key;
  },
}));
```

Also mock `openContextMenuQuickAction` so the test doesn't need plugin internals wired up:

```typescript
jest.mock('@/features/quickActions/openContextMenuQuickAction', () => ({
  openContextMenuQuickAction: jest.fn(),
}));
```

- [ ] **Step 3: Run menu tests**

```bash
npm run test -- --selectProjects unit --testPathPattern="registerWorkspaceMenus" --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 4: Run full test suite**

```bash
npm run test -- --selectProjects unit --no-coverage
```

Expected: all tests PASS (no regressions).

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors, no warnings.

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/commands/registerWorkspaceMenus.ts \
        tests/unit/app/commands/registerWorkspaceMenus.test.ts
git commit -m "feat: add Quick Actions to file and folder context menus"
```

---

## Self-Review Checklist

- [x] **Spec: modal picker flow** → Task 3 instantiates `QuickActionsModal` and wires `onRun`
- [x] **Spec: reuse blank tab** → `lifecycleState === 'blank'` branch in Task 3
- [x] **Spec: create new tab** → `canCreateTab()` + `createTab({ activate: false })` in Task 3
- [x] **Spec: tab limit error** → `Notice(t('quickActions.contextMenu.tabLimitReached'))` in Task 3
- [x] **Spec: file chip** → `attachFileAsPill` for `TFile` in Task 3
- [x] **Spec: folder chip** → `attachFolderAsPill` for `TFolder` in Task 3
- [x] **Spec: send immediately** → `sendMessage({ content: action.prompt })` in Task 3
- [x] **Spec: both TFile and TFolder wired** → Task 4 adds item to both branches
- [x] **Spec: i18n keys** → Task 1 covers all 10 locales + types.ts
- [x] **Spec: ensureViewOpen equivalent** → `getView() ?? activateView() + getView()` in Task 3
- [x] **Tests: all 6 test cases** → all covered in Task 2 test file
- [x] **Type consistency** → `openContextMenuQuickAction` signature stable across Tasks 2/3/4
