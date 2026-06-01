import type { Editor } from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';

import { registerCommandHotkey } from '@/core/commands/commandHotkeyRegistry';
import { type InlineEditContext, InlineEditModal } from '@/features/inline-edit/ui/InlineEditModal';
import {
  createWorkOrderFromBrowserSelection,
  createWorkOrderTemplate,
} from '@/features/tasks/commands/taskCommands';
import type { ChatTabExecutionSurface } from '@/features/tasks/execution/ChatTabExecutionSurface';
import type { ChatWorkOrderLinker } from '@/features/tasks/execution/ChatWorkOrderLinker';
import { installPresetTemplates } from '@/features/tasks/templates/installPresetTemplates';
import {
  createWorkOrderFromCurrentNoteInteractive,
  createWorkOrderFromSelectionInteractive,
  createWorkOrderInteractive,
} from '@/features/tasks/ui/createWorkOrderInteractive';
import type ClaudianPlugin from '@/main';
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
