import { Notice, type TAbstractFile,TFile, TFolder } from 'obsidian';

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

        // Bring the tab into focus FIRST. switchToTab triggers
        // ConversationController.initializeWelcome() on a blank tab, which calls
        // FileContextManager.resetForNewConversation() and wipes any pill we
        // attached beforehand. Attach AFTER the switch resolves so the pill
        // survives and gets folded into the outgoing prompt via
        // FileContextManager.getAttachedMentionSuffix().
        //
        // Tradeoff: switch runs unconditionally even when reusing the active
        // blank tab, so any prior manual pills on that tab are wiped by the
        // reset — acceptable since the user just invoked a quick action
        // explicitly targeting a different file/folder. Do not add a
        // self-switch guard without revisiting the spec.
        await tabManager.switchToTab(targetTab.id);

        // Attach the right-clicked file or folder as a visible chip.
        if (file instanceof TFile) {
          targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
        } else if (file instanceof TFolder) {
          targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
        }

        // Fire the prompt — sendMessage folds attached pills into content.
        void targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
      })();
    },
  }).open();
}
