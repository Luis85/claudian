import type { TAbstractFile } from 'obsidian';

import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type ClaudianPlugin from '@/main';

import { QuickActionStorage } from './QuickActionStorage';
import { runQuickActionForFile } from './runQuickActionForFile';
import { QuickActionsModal } from './ui/QuickActionsModal';

/**
 * Opens the quick actions picker modal for the given vault file or folder.
 * On selection, delegates to runQuickActionForFile which encapsulates the
 * shared tab/pill/send flow also used by favorite menu items.
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
      void runQuickActionForFile(plugin, file, action);
    },
    onFavoritesChanged: () => plugin.quickActionFavoritesCache?.refresh(),
  }).open();
}
