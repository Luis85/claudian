---
status: done
---
# main.ts refactor — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract focused collaborators out of `src/main.ts` so `ClaudianPlugin` shrinks from 1059 LOC to ≤500 LOC and `onload()` shrinks from ~400 LOC to ≤60 LOC, while keeping `PluginContext` byte-identical.

**Architecture:** Five extracted modules under `src/app/`: command registration, menu registration, view activation, environment apply, and lifecycle teardown. Each is a plain class or function with constructor/parameter-injected `ClaudianPlugin` (or narrower typed subset). Plugin shell news them up in `onload()` and delegates `PluginContext` methods to them.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest (with `@/` path alias mapping to `src/`).

**Spec:** [`docs/superpowers/specs/2026-06-01-main-ts-refactor-design.md`](../specs/2026-06-01-main-ts-refactor-design.md)

---

## File structure

Per-task file ownership. Each task self-contained; no later task depends on later-task code being present.

| Task | Files created | Files modified |
|------|---------------|----------------|
| 1 | `src/app/commands/registerWorkspaceMenus.ts`, `tests/unit/app/commands/registerWorkspaceMenus.test.ts` | `src/main.ts` |
| 2 | `src/app/commands/registerPluginCommands.ts`, `tests/unit/app/commands/registerPluginCommands.test.ts` | `src/main.ts` |
| 3 | `src/app/lifecycle/PluginLifecycle.ts`, `tests/unit/app/lifecycle/PluginLifecycle.test.ts` | `src/main.ts` |
| 4 | `src/app/views/PluginViewActivator.ts`, `tests/unit/app/views/PluginViewActivator.test.ts` | `src/main.ts` |
| 5 | `src/app/environment/EnvironmentApplyService.ts`, `tests/unit/app/environment/EnvironmentApplyService.test.ts` | `src/main.ts` |

Each module imports `ClaudianPlugin` as `import type` only to avoid runtime cycles.

---

## Task 1: Extract workspace menus

**Files:**
- Create: `src/app/commands/registerWorkspaceMenus.ts`
- Create: `tests/unit/app/commands/registerWorkspaceMenus.test.ts`
- Modify: `src/main.ts` (remove lines 310-362; replace with single call)

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/commands/registerWorkspaceMenus.test.ts`:

```ts
import type { Editor, Menu, MenuItem, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { registerWorkspaceMenus } from '@/app/commands/registerWorkspaceMenus';
import type ClaudianPlugin from '@/main';

type FileMenuHandler = (menu: Menu, file: TAbstractFile) => void;
type EditorMenuHandler = (menu: Menu, editor: Editor) => void;

function createMenuItem(): MenuItem {
  const item = {
    setTitle: jest.fn().mockReturnThis(),
    setIcon: jest.fn().mockReturnThis(),
    onClick: jest.fn().mockReturnThis(),
  };
  return item as unknown as MenuItem;
}

function createMenu(): { menu: Menu; items: MenuItem[] } {
  const items: MenuItem[] = [];
  const menu = {
    addItem: jest.fn((cb: (item: MenuItem) => void) => {
      const item = createMenuItem();
      items.push(item);
      cb(item);
      return menu;
    }),
  } as unknown as Menu;
  return { menu, items };
}

function createPlugin(): {
  plugin: ClaudianPlugin;
  fileMenu: { handler: FileMenuHandler | null };
  editorMenu: { handler: EditorMenuHandler | null };
} {
  const fileMenu: { handler: FileMenuHandler | null } = { handler: null };
  const editorMenu: { handler: EditorMenuHandler | null } = { handler: null };
  const plugin = {
    registerEvent: jest.fn((_evtRef: unknown) => undefined),
    app: {
      workspace: {
        on: jest.fn((event: string, handler: unknown) => {
          if (event === 'file-menu') fileMenu.handler = handler as FileMenuHandler;
          if (event === 'editor-menu') editorMenu.handler = handler as EditorMenuHandler;
          return { event } as unknown;
        }),
      },
    },
  } as unknown as ClaudianPlugin;
  return { plugin, fileMenu, editorMenu };
}

describe('registerWorkspaceMenus', () => {
  it('registers both file-menu and editor-menu handlers', () => {
    const { plugin } = createPlugin();
    registerWorkspaceMenus(plugin);
    expect((plugin.app.workspace.on as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      'file-menu',
      'editor-menu',
    ]);
    expect(plugin.registerEvent).toHaveBeenCalledTimes(2);
  });

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

  it('skips editor-menu item when selection is empty', () => {
    const { plugin, editorMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const editor = { getSelection: () => '   ' } as unknown as Editor;
    const { menu, items } = createMenu();
    editorMenu.handler!(menu, editor);
    expect(items).toHaveLength(0);
  });

  it('adds editor-menu item when selection is non-empty', () => {
    const { plugin, editorMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const editor = { getSelection: () => 'hello' } as unknown as Editor;
    const { menu, items } = createMenu();
    editorMenu.handler!(menu, editor);
    expect(items).toHaveLength(1);
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith(
      'Create work order from selection',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/app/commands/registerWorkspaceMenus.test.ts`
Expected: FAIL with `Cannot find module '@/app/commands/registerWorkspaceMenus'`.

- [ ] **Step 3: Implement the module**

Create `src/app/commands/registerWorkspaceMenus.ts`:

```ts
import type { Editor, Menu, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { createWorkOrderFromSelectionInteractive, createWorkOrderInteractive } from '@/features/tasks/ui/createWorkOrderInteractive';
import type ClaudianPlugin from '@/main';

export function registerWorkspaceMenus(plugin: ClaudianPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
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
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
      if (!editor.getSelection().trim()) return;
      menu.addItem((item) => {
        item
          .setTitle('Create work order from selection')
          .setIcon('kanban-square')
          .onClick(() => {
            void createWorkOrderFromSelectionInteractive(plugin);
          });
      });
    }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/app/commands/registerWorkspaceMenus.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire into main.ts**

In `src/main.ts`:

Add to imports:
```ts
import { registerWorkspaceMenus } from './app/commands/registerWorkspaceMenus';
```

Remove the `import type { Editor, Menu, TAbstractFile, ... } from 'obsidian'` entries that are no longer used by `main.ts` after deletion. Keep `WorkspaceLeaf` (still used in `getLeafForPlacement`).

Remove existing lines 310-362 (both `registerEvent` blocks for `file-menu` and `editor-menu`). Replace with:
```ts
registerWorkspaceMenus(this);
```

Remove now-unused imports: `createWorkOrderFromSelectionInteractive` stays (still used by command), `createWorkOrderInteractive` stays (still used by command), `Editor`, `Menu`, `TAbstractFile`, `TFile`, `TFolder` if no remaining references — verify after edit.

- [ ] **Step 6: Run full verification**

Run all in sequence:
```bash
npm run typecheck
npm run lint
npm run test -- --selectProjects unit
npm run build
```
Expected: all four pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/commands/registerWorkspaceMenus.ts \
        tests/unit/app/commands/registerWorkspaceMenus.test.ts \
        src/main.ts
git commit -m "refactor(main): extract registerWorkspaceMenus from ClaudianPlugin"
```

---

## Task 2: Extract command registration

**Files:**
- Create: `src/app/commands/registerPluginCommands.ts`
- Create: `tests/unit/app/commands/registerPluginCommands.test.ts`
- Modify: `src/main.ts` (remove command-registration blocks from `onload`)

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/commands/registerPluginCommands.test.ts`:

```ts
import {
  getCommandHotkeys,
  resetCommandHotkeysForTests,
} from '@/core/commands/commandHotkeyRegistry';
import { registerPluginCommands } from '@/app/commands/registerPluginCommands';
import type { ChatTabExecutionSurface } from '@/features/tasks/execution/ChatTabExecutionSurface';
import type { ChatWorkOrderLinker } from '@/features/tasks/execution/ChatWorkOrderLinker';
import type ClaudianPlugin from '@/main';

type AnyCommand = {
  id: string;
  name: string;
  callback?: () => unknown;
  editorCallback?: (...args: unknown[]) => unknown;
  checkCallback?: (checking: boolean) => boolean;
};

function createPlugin(): { plugin: ClaudianPlugin; commands: AnyCommand[] } {
  const commands: AnyCommand[] = [];
  const plugin = {
    addCommand: jest.fn((cmd: AnyCommand) => {
      commands.push(cmd);
    }),
    logger: { clear: jest.fn() },
    app: {
      workspace: {
        getActiveViewOfType: jest.fn().mockReturnValue(null),
        getLeavesOfType: jest.fn().mockReturnValue([]),
      },
    },
    settings: { maxTabs: 3 },
    copyDiagnosticLogs: jest.fn(),
  } as unknown as ClaudianPlugin;
  return { plugin, commands };
}

const EXPECTED_COMMAND_IDS = [
  'open-view',
  'open-agent-board',
  'run-next-ready-work-order',
  'create-work-order',
  'create-work-order-from-current-note',
  'create-work-order-from-selection',
  'create-work-order-template',
  'install-common-work-order-templates',
  'create-work-order-from-browser-selection',
  'create-work-order-from-chat-conversation',
  'copy-diagnostic-logs',
  'clear-diagnostic-logs',
  'inline-edit',
  'new-tab',
  'new-session',
  'close-current-tab',
];

describe('registerPluginCommands', () => {
  beforeEach(() => {
    resetCommandHotkeysForTests();
  });

  it('registers the expected command ids', () => {
    const { plugin, commands } = createPlugin();
    const taskExecutionSurface = {} as ChatTabExecutionSurface;
    const chatWorkOrderLinker = {} as ChatWorkOrderLinker;

    registerPluginCommands({ plugin, taskExecutionSurface, chatWorkOrderLinker });

    expect(commands.map((c) => c.id)).toEqual(EXPECTED_COMMAND_IDS);
  });

  it('registers a hotkey entry for every command', () => {
    const { plugin } = createPlugin();
    registerPluginCommands({
      plugin,
      taskExecutionSurface: {} as ChatTabExecutionSurface,
      chatWorkOrderLinker: {} as ChatWorkOrderLinker,
    });

    expect(getCommandHotkeys().map((h) => h.commandId)).toEqual(EXPECTED_COMMAND_IDS);
  });

  it('clear-diagnostic-logs invokes plugin.logger.clear', () => {
    const { plugin, commands } = createPlugin();
    registerPluginCommands({
      plugin,
      taskExecutionSurface: {} as ChatTabExecutionSurface,
      chatWorkOrderLinker: {} as ChatWorkOrderLinker,
    });
    const cmd = commands.find((c) => c.id === 'clear-diagnostic-logs')!;
    cmd.callback?.();
    expect((plugin.logger.clear as jest.Mock)).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/app/commands/registerPluginCommands.test.ts`
Expected: FAIL with `Cannot find module '@/app/commands/registerPluginCommands'`.

- [ ] **Step 3: Implement the module**

Create `src/app/commands/registerPluginCommands.ts`. Copy the command definitions verbatim from `src/main.ts` lines 125-308 and 364-483, threaded through a `plugin` parameter. The factory body:

```ts
import type { Editor } from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';

import { registerCommandHotkey } from '@/core/commands/commandHotkeyRegistry';
import type { ChatTabExecutionSurface } from '@/features/tasks/execution/ChatTabExecutionSurface';
import type { ChatWorkOrderLinker } from '@/features/tasks/execution/ChatWorkOrderLinker';
import { type InlineEditContext, InlineEditModal } from '@/features/inline-edit/ui/InlineEditModal';
import {
  createWorkOrderFromBrowserSelection,
  createWorkOrderTemplate,
} from '@/features/tasks/commands/taskCommands';
import { installPresetTemplates } from '@/features/tasks/templates/installPresetTemplates';
import {
  createWorkOrderFromCurrentNoteInteractive,
  createWorkOrderFromSelectionInteractive,
  createWorkOrderInteractive,
} from '@/features/tasks/ui/createWorkOrderInteractive';
import type ClaudianPlugin from '@/main';
import { chatMessageText } from '@/utils/chatMessageText';
import { buildCursorContext } from '@/utils/editor';

export interface PluginCommandDeps {
  plugin: ClaudianPlugin;
  taskExecutionSurface: ChatTabExecutionSurface;
  chatWorkOrderLinker: ChatWorkOrderLinker;
}

export function registerPluginCommands(deps: PluginCommandDeps): void {
  const { plugin, chatWorkOrderLinker } = deps;
  // taskExecutionSurface is reserved for future commands that need it (currently
  // consumed by AgentBoardView via main.ts onload). Kept on the deps object to
  // keep the factory's contract stable.
  void deps.taskExecutionSurface;

  const openViewCmd = {
    id: 'open-view',
    name: 'Open chat view',
    callback: () => {
      void plugin.activateView();
    },
  };
  plugin.addCommand(openViewCmd);
  registerCommandHotkey({ commandId: openViewCmd.id, label: openViewCmd.name });

  const openAgentBoardCmd = {
    id: 'open-agent-board',
    name: 'Open Agent Board',
    callback: () => {
      void plugin.activateAgentBoardView();
    },
  };
  plugin.addCommand(openAgentBoardCmd);
  registerCommandHotkey({ commandId: openAgentBoardCmd.id, label: openAgentBoardCmd.name });

  const runNextReadyCmd = {
    id: 'run-next-ready-work-order',
    name: 'Run next ready work order',
    callback: () => {
      void plugin.runNextReadyWorkOrder();
    },
  };
  plugin.addCommand(runNextReadyCmd);
  registerCommandHotkey({ commandId: runNextReadyCmd.id, label: runNextReadyCmd.name });

  const createWorkOrderCmd = {
    id: 'create-work-order',
    name: 'Create work order',
    callback: () => {
      void createWorkOrderInteractive(plugin);
    },
  };
  plugin.addCommand(createWorkOrderCmd);
  registerCommandHotkey({ commandId: createWorkOrderCmd.id, label: createWorkOrderCmd.name });

  const createWorkOrderFromCurrentNoteCmd = {
    id: 'create-work-order-from-current-note',
    name: 'Create work order from current note',
    callback: () => {
      void createWorkOrderFromCurrentNoteInteractive(plugin);
    },
  };
  plugin.addCommand(createWorkOrderFromCurrentNoteCmd);
  registerCommandHotkey({
    commandId: createWorkOrderFromCurrentNoteCmd.id,
    label: createWorkOrderFromCurrentNoteCmd.name,
  });

  const createWorkOrderFromSelectionCmd = {
    id: 'create-work-order-from-selection',
    name: 'Create work order from selection',
    editorCallback: () => {
      void createWorkOrderFromSelectionInteractive(plugin);
    },
  };
  plugin.addCommand(createWorkOrderFromSelectionCmd);
  registerCommandHotkey({
    commandId: createWorkOrderFromSelectionCmd.id,
    label: createWorkOrderFromSelectionCmd.name,
  });

  const createWorkOrderTemplateCmd = {
    id: 'create-work-order-template',
    name: 'Create work-order template',
    callback: () => {
      void createWorkOrderTemplate(plugin);
    },
  };
  plugin.addCommand(createWorkOrderTemplateCmd);
  registerCommandHotkey({
    commandId: createWorkOrderTemplateCmd.id,
    label: createWorkOrderTemplateCmd.name,
  });

  const installCommonTemplatesCmd = {
    id: 'install-common-work-order-templates',
    name: 'Install common work-order templates',
    callback: () => {
      void (async () => {
        const result = await installPresetTemplates(plugin);
        const parts: string[] = [];
        if (result.installed > 0) parts.push(`installed ${result.installed}`);
        if (result.skipped > 0) parts.push(`skipped ${result.skipped} already present`);
        new Notice(`Common work-order templates: ${parts.join(', ') || 'nothing to do'}.`);
      })();
    },
  };
  plugin.addCommand(installCommonTemplatesCmd);
  registerCommandHotkey({
    commandId: installCommonTemplatesCmd.id,
    label: installCommonTemplatesCmd.name,
  });

  const createWorkOrderFromBrowserSelectionCmd = {
    id: 'create-work-order-from-browser-selection',
    name: 'Create work order from browser selection',
    callback: () => {
      void createWorkOrderFromBrowserSelection(plugin);
    },
  };
  plugin.addCommand(createWorkOrderFromBrowserSelectionCmd);
  registerCommandHotkey({
    commandId: createWorkOrderFromBrowserSelectionCmd.id,
    label: createWorkOrderFromBrowserSelectionCmd.name,
  });

  const createWorkOrderFromChatConvCmd = {
    id: 'create-work-order-from-chat-conversation',
    name: 'Create work order from current chat conversation',
    callback: () => {
      void chatWorkOrderLinker.promoteActiveConversationToWorkOrder();
    },
  };
  plugin.addCommand(createWorkOrderFromChatConvCmd);
  registerCommandHotkey({
    commandId: createWorkOrderFromChatConvCmd.id,
    label: createWorkOrderFromChatConvCmd.name,
  });

  const copyDiagnosticLogsCmd = {
    id: 'copy-diagnostic-logs',
    name: 'Copy diagnostic logs',
    callback: () => {
      void plugin.copyDiagnosticLogs();
    },
  };
  plugin.addCommand(copyDiagnosticLogsCmd);
  registerCommandHotkey({
    commandId: copyDiagnosticLogsCmd.id,
    label: copyDiagnosticLogsCmd.name,
  });

  const clearDiagnosticLogsCmd = {
    id: 'clear-diagnostic-logs',
    name: 'Clear diagnostic logs',
    callback: () => {
      plugin.logger.clear();
      new Notice('Diagnostic logs cleared');
    },
  };
  plugin.addCommand(clearDiagnosticLogsCmd);
  registerCommandHotkey({
    commandId: clearDiagnosticLogsCmd.id,
    label: clearDiagnosticLogsCmd.name,
  });

  const inlineEditCmd = {
    id: 'inline-edit',
    name: 'Inline edit',
    editorCallback: async (editor: Editor, ctx: unknown) => {
      const view = ctx instanceof MarkdownView
        ? ctx
        : plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        new Notice('Inline edit unavailable: could not access the active Markdown view.');
        return;
      }

      const selectedText = editor.getSelection();
      const notePath = view.file?.path || 'unknown';

      let editContext: InlineEditContext;
      if (selectedText.trim()) {
        editContext = { mode: 'selection', selectedText };
      } else {
        const cursor = editor.getCursor();
        const cursorContext = buildCursorContext(
          (line) => editor.getLine(line),
          editor.lineCount(),
          cursor.line,
          cursor.ch,
        );
        editContext = { mode: 'cursor', cursorContext };
      }

      const modal = new InlineEditModal(
        plugin.app,
        plugin,
        editor,
        view,
        editContext,
        notePath,
        () => plugin.getView()?.getActiveTab()?.ui.externalContextSelector?.getExternalContexts() ?? [],
      );
      const result = await modal.openAndWait();

      if (result.decision === 'accept' && result.editedText !== undefined) {
        new Notice(editContext.mode === 'cursor' ? 'Inserted' : 'Edit applied');
      }
    },
  };
  plugin.addCommand(inlineEditCmd);
  registerCommandHotkey({ commandId: inlineEditCmd.id, label: inlineEditCmd.name });

  const newTabCmd = {
    id: 'new-tab',
    name: 'New tab',
    checkCallback: (checking: boolean) => {
      if (!plugin.canCreateNewTab()) return false;
      if (!checking) {
        void plugin.openNewTab();
      }
      return true;
    },
  };
  plugin.addCommand(newTabCmd);
  registerCommandHotkey({ commandId: newTabCmd.id, label: newTabCmd.name });

  const newSessionCmd = {
    id: 'new-session',
    name: 'New session (in current tab)',
    checkCallback: (checking: boolean) => {
      const view = plugin.getView();
      if (!view) return false;
      const tabManager = view.getTabManager();
      if (!tabManager) return false;
      const activeTab = tabManager.getActiveTab();
      if (!activeTab) return false;
      if (activeTab.state.isStreaming) return false;
      if (!checking) {
        void tabManager.createNewConversation();
      }
      return true;
    },
  };
  plugin.addCommand(newSessionCmd);
  registerCommandHotkey({ commandId: newSessionCmd.id, label: newSessionCmd.name });

  const closeCurrentTabCmd = {
    id: 'close-current-tab',
    name: 'Close current tab',
    checkCallback: (checking: boolean) => {
      const view = plugin.getView();
      if (!view) return false;
      const tabManager = view.getTabManager();
      if (!tabManager) return false;
      if (!checking) {
        const activeTabId = tabManager.getActiveTabId();
        if (activeTabId) {
          void tabManager.closeTab(activeTabId);
        }
      }
      return true;
    },
  };
  plugin.addCommand(closeCurrentTabCmd);
  registerCommandHotkey({ commandId: closeCurrentTabCmd.id, label: closeCurrentTabCmd.name });
}
```

Notes for the implementer:
- The factory references `plugin.activateAgentBoardView`, `plugin.runNextReadyWorkOrder`, `plugin.canCreateNewTab`, `plugin.openNewTab`. These exist as private methods today. Make them public (drop `private`) on `ClaudianPlugin` so the factory can call them. They remain part of the same class; only visibility changes.

- [ ] **Step 4: Make required plugin methods public**

In `src/main.ts`, change these method signatures:
- `private async runNextReadyWorkOrder` → `async runNextReadyWorkOrder`
- `private canCreateNewTab` → `canCreateNewTab`
- `private async openNewTab` → `async openNewTab`

(`activateAgentBoardView` is already public.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/app/commands/registerPluginCommands.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Wire into main.ts**

Add import:
```ts
import { registerPluginCommands } from './app/commands/registerPluginCommands';
```

Remove lines covering each addCommand block (current 125-308 minus the chat-message-action block at 262-270, plus 364-483). Replace with the single call after `chatWorkOrderLinker` is constructed and after `registerChatMessageAction`:

```ts
registerPluginCommands({ plugin: this, taskExecutionSurface, chatWorkOrderLinker });
```

Keep the chat-message-action `registerChatMessageAction({ … })` block in `onload` — it's the only non-command registration in that range.

Remove now-unused imports (verify after edit): `chatMessageText`, `MarkdownView`, `Editor` (if not used elsewhere), `buildCursorContext`, `createWorkOrderFromBrowserSelection`, `createWorkOrderTemplate`, `installPresetTemplates`, `createWorkOrderFromCurrentNoteInteractive`, `createWorkOrderFromSelectionInteractive` (verify — also used by menus extracted in Task 1), `InlineEditContext`, `InlineEditModal`, `registerCommandHotkey`. The `chatMessageText` import stays if the chat-message-action `isEligible` predicate still uses it.

- [ ] **Step 7: Run full verification**

```bash
npm run typecheck
npm run lint
npm run test -- --selectProjects unit
npm run build
```
Expected: all four pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/commands/registerPluginCommands.ts \
        tests/unit/app/commands/registerPluginCommands.test.ts \
        src/main.ts
git commit -m "refactor(main): extract registerPluginCommands from ClaudianPlugin"
```

---

## Task 3: Extract lifecycle teardown

**Files:**
- Create: `src/app/lifecycle/PluginLifecycle.ts`
- Create: `tests/unit/app/lifecycle/PluginLifecycle.test.ts`
- Modify: `src/main.ts` (remove `installGitWatcher` body in onload, `shutdownActiveRuntimes`, `persistOpenTabStates`)

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/lifecycle/PluginLifecycle.test.ts`:

```ts
import { PluginLifecycle } from '@/app/lifecycle/PluginLifecycle';
import type { ClaudianView } from '@/features/chat/ClaudianView';
import type ClaudianPlugin from '@/main';
import * as pathUtils from '@/utils/path';

function createTab(opts: { cleanup?: () => Promise<void> | void } = {}) {
  return {
    service: { cleanup: jest.fn(opts.cleanup ?? (() => undefined)) },
  };
}

function createView(tabs: ReturnType<typeof createTab>[]) {
  const tabManager = {
    getAllTabs: jest.fn().mockReturnValue(tabs),
    getPersistedState: jest.fn().mockReturnValue({ openTabs: [] }),
  };
  return {
    getTabManager: jest.fn().mockReturnValue(tabManager),
  } as unknown as ClaudianView;
}

function createPlugin(views: ClaudianView[]): ClaudianPlugin {
  return {
    getAllViews: jest.fn().mockReturnValue(views),
    persistTabManagerState: jest.fn().mockResolvedValue(undefined),
    app: { vault: { on: jest.fn(), } },
  } as unknown as ClaudianPlugin;
}

describe('PluginLifecycle.shutdownActiveRuntimes', () => {
  it('calls cleanup on every tab across every view', () => {
    const tabsA = [createTab(), createTab()];
    const tabsB = [createTab()];
    const plugin = createPlugin([createView(tabsA), createView(tabsB)]);
    const lifecycle = new PluginLifecycle(plugin);

    lifecycle.shutdownActiveRuntimes();

    for (const tab of [...tabsA, ...tabsB]) {
      expect(tab.service.cleanup).toHaveBeenCalledTimes(1);
    }
  });

  it('swallows cleanup errors and keeps tearing down remaining tabs', () => {
    const throwingTab = createTab({ cleanup: () => { throw new Error('boom'); } });
    const okTab = createTab();
    const plugin = createPlugin([createView([throwingTab, okTab])]);
    const lifecycle = new PluginLifecycle(plugin);

    expect(() => lifecycle.shutdownActiveRuntimes()).not.toThrow();
    expect(okTab.service.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('PluginLifecycle.persistOpenTabStates', () => {
  it('saves state for every view in parallel', async () => {
    const viewA = createView([]);
    const viewB = createView([]);
    const plugin = createPlugin([viewA, viewB]);
    const lifecycle = new PluginLifecycle(plugin);

    await lifecycle.persistOpenTabStates();

    expect(plugin.persistTabManagerState).toHaveBeenCalledTimes(2);
  });
});

describe('PluginLifecycle.installGitWatcher', () => {
  afterEach(() => jest.restoreAllMocks());

  it('no-ops when getVaultPath returns null', () => {
    jest.spyOn(pathUtils, 'getVaultPath').mockReturnValue(null as unknown as string);
    const plugin = {
      gitStatusWatcher: null,
      registerEvent: jest.fn(),
      app: { vault: { on: jest.fn() } },
    } as unknown as ClaudianPlugin;
    const lifecycle = new PluginLifecycle(plugin);

    lifecycle.installGitWatcher();

    expect(plugin.gitStatusWatcher).toBeNull();
    expect(plugin.registerEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/app/lifecycle/PluginLifecycle.test.ts`
Expected: FAIL with `Cannot find module '@/app/lifecycle/PluginLifecycle'`.

- [ ] **Step 3: Implement the module**

Create `src/app/lifecycle/PluginLifecycle.ts`:

```ts
import { debounce } from 'obsidian';

import { GitService } from '@/features/chat/services/GitService';
import { GitStatusWatcher } from '@/features/chat/services/GitStatusWatcher';
import type ClaudianPlugin from '@/main';
import { getEnhancedPath } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

export class PluginLifecycle {
  constructor(private readonly plugin: ClaudianPlugin) {}

  installGitWatcher(): void {
    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) return;

    this.plugin.gitStatusWatcher = new GitStatusWatcher(
      new GitService(vaultPath, getEnhancedPath()),
    );
    const refreshGit = debounce(
      () => void this.plugin.gitStatusWatcher?.refresh(),
      1500,
      true,
    );
    this.plugin.registerEvent(this.plugin.app.vault.on('modify', () => refreshGit()));
    this.plugin.registerEvent(this.plugin.app.vault.on('create', () => refreshGit()));
    this.plugin.registerEvent(this.plugin.app.vault.on('delete', () => refreshGit()));
    this.plugin.registerEvent(this.plugin.app.vault.on('rename', () => refreshGit()));
  }

  shutdownActiveRuntimes(): void {
    for (const view of this.plugin.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;
      for (const tab of tabManager.getAllTabs()) {
        try {
          void tab.service?.cleanup();
        } catch {
          // best-effort: keep tearing down remaining runtimes
        }
      }
    }
  }

  async persistOpenTabStates(): Promise<void> {
    await Promise.all(
      this.plugin.getAllViews().map((view) => {
        const tabManager = view.getTabManager();
        if (!tabManager) return Promise.resolve();
        return this.plugin.persistTabManagerState(tabManager.getPersistedState());
      }),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/app/lifecycle/PluginLifecycle.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire into main.ts**

Add import:
```ts
import { PluginLifecycle } from './app/lifecycle/PluginLifecycle';
```

Add field:
```ts
private lifecycle!: PluginLifecycle;
```

In `onload`, replace the git watcher block (current lines 98-112) with:
```ts
this.lifecycle = new PluginLifecycle(this);
this.lifecycle.installGitWatcher();
```

In `onunload`, replace:
```ts
onunload(): void {
  this.gitStatusWatcher?.stop();
  this.gitStatusWatcher = null;
  this.lifecycle.shutdownActiveRuntimes();
  void this.lifecycle.persistOpenTabStates();
}
```

Delete the `private shutdownActiveRuntimes()` method (current 499-511) and the `private async persistOpenTabStates()` method (current 513-524).

Remove now-unused imports: `debounce`, `GitService`, `GitStatusWatcher`, `getEnhancedPath`, `getVaultPath` (verify — `getVaultPath` is also used in `loadSettings`).

- [ ] **Step 6: Run full verification**

```bash
npm run typecheck
npm run lint
npm run test -- --selectProjects unit
npm run build
```
Expected: all four pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/lifecycle/PluginLifecycle.ts \
        tests/unit/app/lifecycle/PluginLifecycle.test.ts \
        src/main.ts
git commit -m "refactor(main): extract PluginLifecycle from ClaudianPlugin"
```

---

## Task 4: Extract view activator

**Files:**
- Create: `src/app/views/PluginViewActivator.ts`
- Create: `tests/unit/app/views/PluginViewActivator.test.ts`
- Modify: `src/main.ts` (remove activate/canCreate/openNewTab/getLeafForPlacement methods)

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/views/PluginViewActivator.test.ts`:

```ts
import { PluginViewActivator } from '@/app/views/PluginViewActivator';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type ClaudianPlugin from '@/main';

function createPlugin(opts: {
  existingViewLeaves?: unknown[];
  hasLiveView?: boolean;
  tabManager?: { canCreateTab?: () => boolean } | null;
  lastKnownOpenTabCount?: number;
  maxTabs?: number;
  placement?: 'main-tab' | 'left-sidebar' | 'right-sidebar';
} = {}) {
  const leaves = opts.existingViewLeaves ?? [];
  const view = opts.hasLiveView
    ? { getTabManager: () => opts.tabManager ?? null, createNewTab: jest.fn().mockResolvedValue(undefined) }
    : null;
  const newLeafTab = { setViewState: jest.fn().mockResolvedValue(undefined) };
  const plugin = {
    app: {
      workspace: {
        getLeavesOfType: jest.fn((type: string) =>
          type === VIEW_TYPE_CLAUDIAN ? leaves : [],
        ),
        getLeaf: jest.fn().mockReturnValue(newLeafTab),
        getLeftLeaf: jest.fn().mockReturnValue(newLeafTab),
        getRightLeaf: jest.fn().mockReturnValue(newLeafTab),
        revealLeaf: jest.fn(),
      },
    },
    settings: {
      chatViewPlacement: opts.placement ?? 'main-tab',
      maxTabs: opts.maxTabs ?? 3,
    },
    getView: jest.fn().mockReturnValue(view),
    lastKnownTabManagerState: { openTabs: new Array(opts.lastKnownOpenTabCount ?? 0).fill({}) },
  } as unknown as ClaudianPlugin;
  return { plugin, newLeafTab };
}

describe('PluginViewActivator.canCreateNewTab', () => {
  it('uses tabManager.canCreateTab when a live view exists', () => {
    const { plugin } = createPlugin({
      hasLiveView: true,
      tabManager: { canCreateTab: () => false },
    });
    const activator = new PluginViewActivator(plugin);
    expect(activator.canCreateNewTab()).toBe(false);
  });

  it('honors maxTabs clamp [3,10] when relying on last-known state', () => {
    const { plugin } = createPlugin({ lastKnownOpenTabCount: 9, maxTabs: 12 });
    const activator = new PluginViewActivator(plugin);
    // clamp = min(10, max(3, 12)) = 10; 9 < 10
    expect(activator.canCreateNewTab()).toBe(true);
  });

  it('clamps minimum to 3', () => {
    const { plugin } = createPlugin({ lastKnownOpenTabCount: 2, maxTabs: 1 });
    const activator = new PluginViewActivator(plugin);
    expect(activator.canCreateNewTab()).toBe(true);
  });

  it('returns false when leaves exist but no live view', () => {
    const { plugin } = createPlugin({ existingViewLeaves: [{}] });
    const activator = new PluginViewActivator(plugin);
    expect(activator.canCreateNewTab()).toBe(false);
  });
});

describe('PluginViewActivator.openNewTab', () => {
  it('opens a new tab on the existing view when one is live', async () => {
    const { plugin } = createPlugin({ hasLiveView: true, tabManager: null });
    const activator = new PluginViewActivator(plugin);

    await activator.openNewTab();

    expect((plugin.getView() as { createNewTab: jest.Mock }).createNewTab).toHaveBeenCalled();
  });

  it('does not stack a tab when restoredTabCount is 0', async () => {
    const { plugin, newLeafTab } = createPlugin({ lastKnownOpenTabCount: 0 });
    // First getView() call returns null (no live view), then after activation returns a view.
    const liveView = { createNewTab: jest.fn().mockResolvedValue(undefined), getTabManager: () => null };
    (plugin.getView as jest.Mock).mockReturnValueOnce(null).mockReturnValue(liveView);
    const activator = new PluginViewActivator(plugin);

    await activator.openNewTab();

    expect(liveView.createNewTab).not.toHaveBeenCalled();
    expect(newLeafTab.setViewState).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/app/views/PluginViewActivator.test.ts`
Expected: FAIL with `Cannot find module '@/app/views/PluginViewActivator'`.

- [ ] **Step 3: Implement the module**

Create `src/app/views/PluginViewActivator.ts`:

```ts
import type { WorkspaceLeaf } from 'obsidian';

import { VIEW_TYPE_CLAUDIAN, VIEW_TYPE_CLAUDIAN_AGENT_BOARD } from '@/core/types';
import type { ChatViewPlacement } from '@/core/types/settings';
import { AgentBoardView } from '@/features/tasks/ui/AgentBoardView';
import type { ClaudianView } from '@/features/chat/ClaudianView';
import type ClaudianPlugin from '@/main';
import { revealWorkspaceLeaf } from '@/utils/obsidianCompat';

export class PluginViewActivator {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async activateView(): Promise<void> {
    const { workspace } = this.plugin.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)[0];

    if (!leaf) {
      const newLeaf = this.getLeafForPlacement(this.plugin.settings.chatViewPlacement);
      if (newLeaf) {
        await newLeaf.setViewState({ type: VIEW_TYPE_CLAUDIAN, active: true });
        leaf = newLeaf;
      }
    }

    if (leaf) {
      await revealWorkspaceLeaf(workspace, leaf);
    }
  }

  async activateAgentBoardView(): Promise<void> {
    const { workspace } = this.plugin.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_AGENT_BOARD)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN_AGENT_BOARD, active: true });
    }

    await revealWorkspaceLeaf(workspace, leaf);
  }

  async ensureViewOpen(): Promise<ClaudianView | null> {
    const existingView = this.plugin.getView();
    if (existingView) return existingView;
    await this.activateView();
    return this.plugin.getView();
  }

  async openNewTab(): Promise<void> {
    const existingView = this.plugin.getView();
    if (existingView) {
      await existingView.createNewTab();
      return;
    }

    const restoredTabCount = this.getLastKnownOpenTabCount();
    const view = await this.ensureViewOpen();
    if (!view) return;

    if (restoredTabCount === 0) return;
    await view.createNewTab();
  }

  canCreateNewTab(): boolean {
    const hasClaudianLeaf =
      this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).length > 0;
    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }
    if (hasClaudianLeaf) return false;
    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
  }

  async runNextReadyWorkOrder(): Promise<void> {
    await this.activateAgentBoardView();
    const leaf = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_AGENT_BOARD)[0];
    const view = leaf?.view;
    if (view instanceof AgentBoardView) {
      await view.runNextReady();
    }
  }

  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.plugin.app;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }

  private getLastKnownOpenTabCount(): number {
    return this.plugin.lastKnownTabManagerState?.openTabs.length ?? 0;
  }

  private getMaxTabsLimit(): number {
    const maxTabs = this.plugin.settings.maxTabs ?? 3;
    return Math.max(3, Math.min(10, maxTabs));
  }
}
```

Implementer note: `plugin.lastKnownTabManagerState` is currently `private`. Drop `private` (keep field on `ClaudianPlugin` as public-readonly) so the activator can read it.

- [ ] **Step 4: Make lastKnownTabManagerState accessible**

In `src/main.ts`, change:
```ts
private lastKnownTabManagerState: AppTabManagerState | null = null;
```
to:
```ts
lastKnownTabManagerState: AppTabManagerState | null = null;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/app/views/PluginViewActivator.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire into main.ts**

Add import + field:
```ts
import { PluginViewActivator } from './app/views/PluginViewActivator';
// …
private viewActivator!: PluginViewActivator;
```

In `onload`, after `this.lifecycle = new PluginLifecycle(this);`:
```ts
this.viewActivator = new PluginViewActivator(this);
```

Replace the existing `activateView` method body with:
```ts
async activateView(): Promise<void> {
  return this.viewActivator.activateView();
}
```

Replace `activateAgentBoardView`, `runNextReadyWorkOrder`, `canCreateNewTab`, `openNewTab` with one-line delegates that call `this.viewActivator.*`. Keep `ensureViewOpen` as a private one-liner too if other plugin methods still call it (currently `addFileToActiveChat`, `addFolderToActiveChat`):
```ts
private async ensureViewOpen(): Promise<ClaudianView | null> {
  return this.viewActivator.ensureViewOpen();
}
```

Delete the original method bodies (current `activateView` 566-584, `activateAgentBoardView` 586-599, `runNextReadyWorkOrder` 601-608, `getLeafForPlacement` 610-620, `canCreateNewTab` 622-636, `ensureViewOpen` 638-646, `openNewTab` 648-668, `getLastKnownOpenTabCount` 1050-1052, `getMaxTabsLimit` 1054-1056).

- [ ] **Step 7: Run full verification**

```bash
npm run typecheck
npm run lint
npm run test -- --selectProjects unit
npm run build
```
Expected: all four pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/views/PluginViewActivator.ts \
        tests/unit/app/views/PluginViewActivator.test.ts \
        src/main.ts
git commit -m "refactor(main): extract PluginViewActivator from ClaudianPlugin"
```

---

## Task 5: Extract environment apply service

**Files:**
- Create: `src/app/environment/EnvironmentApplyService.ts`
- Create: `tests/unit/app/environment/EnvironmentApplyService.test.ts`
- Modify: `src/main.ts` (remove env apply methods)

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/environment/EnvironmentApplyService.test.ts`:

```ts
import { EnvironmentApplyService } from '@/app/environment/EnvironmentApplyService';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import * as providerEnv from '@/core/providers/providerEnvironment';
import type { ProviderId } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import type ClaudianPlugin from '@/main';

function createTab(overrides: Partial<{
  providerId: ProviderId;
  isStreaming: boolean;
  service: unknown;
  serviceInitialized: boolean;
  conversationId: string | null;
}> = {}) {
  return {
    providerId: overrides.providerId ?? 'claude',
    state: { isStreaming: overrides.isStreaming ?? false },
    service: overrides.service ?? {
      cleanup: jest.fn(),
      syncConversationState: jest.fn(),
      resetSession: jest.fn(),
      ensureReady: jest.fn().mockResolvedValue(undefined),
    },
    serviceInitialized: overrides.serviceInitialized ?? true,
    conversationId: overrides.conversationId ?? null,
    controllers: { inputController: { cancelStreaming: jest.fn() } },
    ui: { externalContextSelector: undefined },
  };
}

function createPlugin(overrides: Partial<{
  affectedTabs: ReturnType<typeof createTab>[];
  settings: Record<string, unknown>;
  reconcileResult: { changed: boolean; invalidatedConversations: Conversation[] };
}> = {}): ClaudianPlugin {
  const tabs = overrides.affectedTabs ?? [];
  const tabManager = {
    getAllTabs: jest.fn().mockReturnValue(tabs),
  };
  const view = {
    getTabManager: jest.fn().mockReturnValue(tabManager),
    invalidateProviderCommandCaches: jest.fn(),
    refreshModelSelector: jest.fn(),
  };
  return {
    settings: overrides.settings ?? {},
    getView: jest.fn().mockReturnValue(view),
    getAllViews: jest.fn().mockReturnValue([view]),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    storage: {
      sessions: {
        saveMetadata: jest.fn().mockResolvedValue(undefined),
        toSessionMetadata: jest.fn((c: Conversation) => c),
      },
    },
    conversationStore: { getConversations: () => [] },
    getConversationSync: jest.fn().mockReturnValue(null),
  } as unknown as ClaudianPlugin;
}

describe('EnvironmentApplyService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('short-circuits when no scope value changed', async () => {
    jest.spyOn(providerEnv, 'getEnvironmentVariablesForScope').mockReturnValue('X=1');
    const plugin = createPlugin();
    const service = new EnvironmentApplyService(plugin);

    await service.applyBatch([{ scope: 'shared', envText: 'X=1' }]);

    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    // no reconcile path taken
    expect((plugin.storage.sessions.saveMetadata as jest.Mock)).not.toHaveBeenCalled();
  });

  it('expands shared scope to every registered provider', () => {
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue(['claude', 'codex']);
    const plugin = createPlugin();
    const service = new EnvironmentApplyService(plugin);

    const ids = service.affectedProvidersForTests(['shared']);

    expect(ids.sort()).toEqual(['claude', 'codex']);
  });

  it('narrows provider:<id> scope to that one provider when registered', () => {
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue(['claude', 'codex']);
    const plugin = createPlugin();
    const service = new EnvironmentApplyService(plugin);

    const ids = service.affectedProvidersForTests(['provider:codex']);
    expect(ids).toEqual(['codex']);
  });

  it('cancels streaming tabs before restarting them on change', async () => {
    jest.spyOn(providerEnv, 'getEnvironmentVariablesForScope').mockReturnValue('OLD');
    jest.spyOn(providerEnv, 'setEnvironmentVariablesForScope').mockImplementation(() => undefined);
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue(['claude']);
    jest.spyOn(ProviderSettingsCoordinator, 'handleEnvironmentChange').mockImplementation(() => undefined);
    jest.spyOn(ProviderSettingsCoordinator, 'reconcileProviders').mockReturnValue({
      changed: true,
      invalidatedConversations: [],
    });

    const streamingTab = createTab({ isStreaming: true });
    const plugin = createPlugin({ affectedTabs: [streamingTab] });
    const service = new EnvironmentApplyService(plugin);

    await service.apply('shared', 'NEW');

    expect(streamingTab.controllers.inputController.cancelStreaming).toHaveBeenCalled();
    expect((streamingTab.service as { resetSession: jest.Mock }).resetSession).toHaveBeenCalled();
    expect((streamingTab.service as { ensureReady: jest.Mock }).ensureReady).toHaveBeenCalled();
  });
});
```

Note: the test calls a `affectedProvidersForTests` method on the service. Expose it as a public method (alongside the private `affectedProviders`) for testability:
```ts
affectedProvidersForTests(scopes: EnvironmentScope[]): ProviderId[] {
  return this.affectedProviders(scopes);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/app/environment/EnvironmentApplyService.test.ts`
Expected: FAIL with `Cannot find module '@/app/environment/EnvironmentApplyService'`.

- [ ] **Step 3: Implement the module**

Create `src/app/environment/EnvironmentApplyService.ts`:

```ts
import { Notice } from 'obsidian';

import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  setEnvironmentVariablesForScope,
} from '@/core/providers/providerEnvironment';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ProviderId } from '@/core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { asSettingsBag } from '@/core/types';
import type { EnvironmentScope } from '@/core/types/settings';
import type ClaudianPlugin from '@/main';

export class EnvironmentApplyService {
  constructor(private readonly plugin: ClaudianPlugin) {}

  apply(scope: EnvironmentScope, envText: string): Promise<void> {
    return this.applyBatch([{ scope, envText }]);
  }

  async applyBatch(updates: Array<{ scope: EnvironmentScope; envText: string }>): Promise<void> {
    const settingsBag = asSettingsBag(this.plugin.settings);
    const nextEnvByScope = new Map<EnvironmentScope, string>();
    for (const update of updates) nextEnvByScope.set(update.scope, update.envText);

    const changedScopes: EnvironmentScope[] = [];
    for (const [scope, envText] of nextEnvByScope) {
      const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
      if (currentValue !== envText) changedScopes.push(scope);
      setEnvironmentVariablesForScope(settingsBag, scope, envText);
    }

    if (changedScopes.length === 0) {
      await this.plugin.saveSettings();
      return;
    }

    const affected = this.affectedProviders(changedScopes);
    ProviderSettingsCoordinator.handleEnvironmentChange(settingsBag, affected);
    const { changed, invalidatedConversations } = this.reconcileWithEnvironment(affected);
    await this.plugin.saveSettings();

    if (invalidatedConversations.length > 0) {
      for (const conv of invalidatedConversations) {
        await this.plugin.storage.sessions.saveMetadata(
          this.plugin.storage.sessions.toSessionMetadata(conv),
        );
      }
    }

    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      const affectedTabs = tabManager.getAllTabs().filter((tab) =>
        affected.includes(tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID),
      );
      const syncRuntime = (tab: (typeof affectedTabs)[number]): void => {
        if (!tab.service || !tab.serviceInitialized) return;
        const conversation = tab.conversationId
          ? this.plugin.getConversationSync(tab.conversationId)
          : null;
        const hasContext = (conversation?.messages.length ?? 0) > 0;
        const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
          ?? (hasContext
            ? conversation?.externalContextPaths ?? []
            : this.plugin.settings.persistentExternalContextPaths ?? []);
        tab.service.syncConversationState(conversation, externalContextPaths);
      };

      for (const tab of affectedTabs) {
        if (tab.state.isStreaming) tab.controllers.inputController?.cancelStreaming();
      }

      let failedTabs = 0;
      for (const tab of affectedTabs) {
        if (!tab.service || !tab.serviceInitialized) continue;
        try {
          syncRuntime(tab);
          if (changed) {
            tab.service.resetSession();
            await tab.service.ensureReady();
          } else {
            await tab.service.ensureReady({ force: true });
          }
        } catch {
          failedTabs++;
        }
      }
      if (failedTabs > 0) {
        new Notice(`Environment changes applied, but ${failedTabs} affected tab(s) failed to restart.`);
      }
    }

    for (const openView of this.plugin.getAllViews()) {
      openView.invalidateProviderCommandCaches(affected);
      openView.refreshModelSelector();
    }

    new Notice(
      changed
        ? 'Environment variables applied. Sessions will be rebuilt on next message.'
        : 'Environment variables applied.',
    );
  }

  reconcileWithEnvironment(
    providerIds: ProviderId[] = ProviderRegistry.getRegisteredProviderIds(),
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    return ProviderSettingsCoordinator.reconcileProviders(
      this.plugin.settings,
      this.plugin.conversationStore.getConversations(),
      providerIds,
    );
  }

  affectedProvidersForTests(scopes: EnvironmentScope[]): ProviderId[] {
    return this.affectedProviders(scopes);
  }

  private affectedProviders(scopes: EnvironmentScope[]): ProviderId[] {
    const registered = new Set(ProviderRegistry.getRegisteredProviderIds());
    const affected = new Set<ProviderId>();
    for (const scope of scopes) {
      if (scope === 'shared') {
        for (const id of registered) affected.add(id);
        continue;
      }
      const id = scope.slice('provider:'.length);
      if (registered.has(id)) affected.add(id);
    }
    return Array.from(affected);
  }
}
```

Implementer note: `EnvironmentApplyService` reads `plugin.conversationStore`. That field is currently `private` on `ClaudianPlugin`. Drop `private` (or expose via getter) so the service can call `getConversations()`.

- [ ] **Step 4: Expose conversationStore on plugin**

In `src/main.ts`, change:
```ts
private conversationStore!: ConversationStore;
```
to:
```ts
conversationStore!: ConversationStore;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/app/environment/EnvironmentApplyService.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Wire into main.ts**

Add import + field:
```ts
import { EnvironmentApplyService } from './app/environment/EnvironmentApplyService';
// …
private envApply!: EnvironmentApplyService;
```

In `onload`, after `this.viewActivator = …`:
```ts
this.envApply = new EnvironmentApplyService(this);
```

Replace `applyEnvironmentVariables`, `applyEnvironmentVariablesBatch`, `reconcileModelWithEnvironment` (only the call site within `loadSettings` and `applyEnvironmentVariablesBatch`), and `getAffectedEnvironmentProviders` with delegates or remove them:

```ts
applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
  return this.envApply.apply(scope, envText);
}

async applyEnvironmentVariablesBatch(
  updates: Array<{ scope: EnvironmentScope; envText: string }>,
): Promise<void> {
  return this.envApply.applyBatch(updates);
}

private reconcileModelWithEnvironment(providerIds?: ProviderId[]): {
  changed: boolean;
  invalidatedConversations: Conversation[];
} {
  return this.envApply.reconcileWithEnvironment(providerIds);
}
```

Delete the now-replaced original bodies (current 765-876 for apply/applyBatch, 930-939 for `reconcileModelWithEnvironment` body if it duplicates the service, 941-960 for `getAffectedEnvironmentProviders`).

Remove imports that are no longer used by `main.ts` (e.g. `setEnvironmentVariablesForScope`, `getRuntimeEnvironmentText` stays — used by `getActiveEnvironmentVariables`, `getScopedEnvironmentVariables` stays — used by `getEnvironmentVariablesForScope`, `asSettingsBag` if unused, `DEFAULT_CHAT_PROVIDER_ID` if unused, `Notice` stays — many call sites).

- [ ] **Step 7: Run full verification**

```bash
npm run typecheck
npm run lint
npm run test -- --selectProjects unit
npm run build
```
Expected: all four pass.

- [ ] **Step 8: Verify final main.ts size and `onload` size**

```bash
wc -l src/main.ts
```
Expected: ≤500 lines.

Inspect `onload` body length manually (line range from `async onload() {` to its closing brace). Expected: ≤60 lines.

- [ ] **Step 9: Commit**

```bash
git add src/app/environment/EnvironmentApplyService.ts \
        tests/unit/app/environment/EnvironmentApplyService.test.ts \
        src/main.ts
git commit -m "refactor(main): extract EnvironmentApplyService from ClaudianPlugin"
```

---

## Definition of done

- All 5 tasks merged in order.
- `src/main.ts` ≤ 500 LOC.
- `onload()` body ≤ 60 LOC.
- New test files exist for each extracted module, all passing.
- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` clean after each task.
- `PluginContext` diff: zero lines (compared to commit before Task 1).
- No `console.*` introductions.
