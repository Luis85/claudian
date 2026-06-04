import type { TAbstractFile } from 'obsidian';

import type ClaudianPlugin from '@/main';

import { openQuickActionsModal } from './openQuickActionsModal';
import { runQuickActionForFile } from './runQuickActionForFile';

/**
 * Opens the quick actions picker modal for the given vault file or folder.
 * On selection, delegates to runQuickActionForFile which encapsulates the
 * shared tab/pill/send flow also used by favorite menu items. Skills tab
 * routing is owned by `openQuickActionsModal` and `runVaultSkill`.
 */
export function openContextMenuQuickAction(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): void {
  openQuickActionsModal(plugin, {
    file,
    onRun: (action) => {
      void runQuickActionForFile(plugin, file, action);
    },
  });
}
