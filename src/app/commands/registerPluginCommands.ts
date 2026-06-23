import type { Command, Editor } from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';

import { registerCommandHotkey } from '@/core/commands/commandHotkeyRegistry';
import { type InlineEditContext, InlineEditModal } from '@/features/inline-edit/ui/InlineEditModal';
import {
  createWorkOrderFromBrowserSelection,
  createWorkOrderTemplate,
} from '@/features/tasks/commands/taskCommands';
import type { ChatTabExecutionSurface } from '@/features/tasks/execution/ChatTabExecutionSurface';
import type { ChatWorkOrderLinker } from '@/features/tasks/execution/ChatWorkOrderLinker';
import { installPresetTemplatesWithNotice } from '@/features/tasks/templates/installPresetTemplates';
import {
  createWorkOrderFromCurrentNoteInteractive,
  createWorkOrderFromSelectionInteractive,
  createWorkOrderInteractive,
} from '@/features/tasks/ui/createWorkOrderInteractive';
import { VIEW_TYPE_LOOP_LIBRARY } from '@/features/tasks/ui/LoopLibraryView';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';
import { buildCursorContext } from '@/utils/editor';

export interface PluginCommandDeps {
  plugin: ClaudianPlugin;
  taskExecutionSurface: ChatTabExecutionSurface;
  chatWorkOrderLinker: ChatWorkOrderLinker;
}

// Registers an Obsidian command and its companion hotkey entry in lockstep so
// every command id appears in both registries in the same order.
type RegisterCommand = (command: Command) => void;

function createRegistrar(plugin: ClaudianPlugin): RegisterCommand {
  return (command) => {
    plugin.addCommand(command);
    registerCommandHotkey({ commandId: command.id, label: command.name });
  };
}

function registerViewCommands(plugin: ClaudianPlugin, register: RegisterCommand): void {
  register({
    id: 'open-view',
    name: t('commands.openView'),
    callback: () => {
      void plugin.activateView();
    },
  });

  register({
    id: 'open-agent-board',
    name: t('commands.openAgentBoard'),
    callback: () => {
      void plugin.activateAgentBoardView();
    },
  });

  register({
    id: 'run-next-ready-work-order',
    name: t('commands.runNextReadyWorkOrder'),
    callback: () => {
      void plugin.runNextReadyWorkOrder();
    },
  });
}

function registerWorkOrderCommands(
  plugin: ClaudianPlugin,
  chatWorkOrderLinker: ChatWorkOrderLinker,
  register: RegisterCommand,
): void {
  register({
    id: 'create-work-order',
    name: t('commands.createWorkOrder'),
    callback: () => {
      void createWorkOrderInteractive(plugin);
    },
  });

  register({
    id: 'create-work-order-from-current-note',
    name: t('commands.createWorkOrderFromCurrentNote'),
    callback: () => {
      void createWorkOrderFromCurrentNoteInteractive(plugin);
    },
  });

  register({
    id: 'create-work-order-from-selection',
    name: t('commands.createWorkOrderFromSelection'),
    editorCallback: () => {
      void createWorkOrderFromSelectionInteractive(plugin);
    },
  });

  register({
    id: 'create-work-order-template',
    name: t('commands.createWorkOrderTemplate'),
    callback: () => {
      void createWorkOrderTemplate(plugin);
    },
  });

  register({
    id: 'install-common-work-order-templates',
    name: t('commands.installCommonWorkOrderTemplates'),
    callback: () => {
      void installPresetTemplatesWithNotice(plugin);
    },
  });

  register({
    id: 'open-loop-library',
    name: t('commands.openLoopLibrary'),
    callback: () => void plugin.openLeafView(VIEW_TYPE_LOOP_LIBRARY),
  });

  register({
    id: 'create-work-order-from-browser-selection',
    name: t('commands.createWorkOrderFromBrowserSelection'),
    callback: () => {
      void createWorkOrderFromBrowserSelection(plugin);
    },
  });

  register({
    id: 'create-work-order-from-chat-conversation',
    name: t('commands.createWorkOrderFromChatConversation'),
    callback: () => {
      void chatWorkOrderLinker.promoteActiveConversationToWorkOrder();
    },
  });
}

function registerDiagnosticCommands(plugin: ClaudianPlugin, register: RegisterCommand): void {
  register({
    id: 'copy-diagnostic-logs',
    name: t('commands.copyDiagnosticLogs'),
    callback: () => {
      void plugin.copyDiagnosticLogs();
    },
  });

  register({
    id: 'clear-diagnostic-logs',
    name: t('commands.clearDiagnosticLogs'),
    callback: () => {
      plugin.logger.clear();
      new Notice(t('diagnostics.logsCleared'));
    },
  });
}

function registerInlineEditCommand(plugin: ClaudianPlugin, register: RegisterCommand): void {
  register({
    id: 'inline-edit',
    name: t('commands.inlineEdit'),
    editorCallback: async (editor: Editor, ctx: unknown) => {
      const view = ctx instanceof MarkdownView
        ? ctx
        : plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        new Notice(t('inlineEdit.noView'));
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

      const modal = new InlineEditModal(plugin.app, plugin, editor, view, {
        editContext,
        notePath,
        getExternalContexts: () =>
          plugin.getView()?.getActiveTab()?.ui.externalContextSelector?.getExternalContexts() ?? [],
      });
      const result = await modal.openAndWait();

      if (result.decision === 'accept' && result.editedText !== undefined) {
        new Notice(t(editContext.mode === 'cursor' ? 'inlineEdit.inserted' : 'inlineEdit.applied'));
      }
    },
  });
}

function registerTabCommands(plugin: ClaudianPlugin, register: RegisterCommand): void {
  register({
    id: 'new-tab',
    name: t('commands.newTab'),
    checkCallback: (checking: boolean) => {
      if (!plugin.canCreateNewTab()) return false;
      if (!checking) {
        void plugin.openNewTab();
      }
      return true;
    },
  });

  register({
    id: 'new-session',
    name: t('commands.newSession'),
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
  });

  register({
    id: 'close-current-tab',
    name: t('commands.closeCurrentTab'),
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
  });
}

export function registerPluginCommands(deps: PluginCommandDeps): void {
  const { plugin, chatWorkOrderLinker } = deps;
  // taskExecutionSurface is reserved for future commands that need it (currently
  // consumed by AgentBoardView via main.ts onload). Kept on the deps object to
  // keep the factory's contract stable.
  void deps.taskExecutionSurface;

  const register = createRegistrar(plugin);

  registerViewCommands(plugin, register);
  registerWorkOrderCommands(plugin, chatWorkOrderLinker, register);
  registerDiagnosticCommands(plugin, register);
  registerInlineEditCommand(plugin, register);
  registerTabCommands(plugin, register);
}
