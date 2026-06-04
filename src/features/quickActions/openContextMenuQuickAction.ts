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
