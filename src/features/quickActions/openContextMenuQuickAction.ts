import type { TAbstractFile } from 'obsidian';

import type SpecoratorPlugin from '@/main';

import { launchQuickAction } from './launchQuickAction';
import { openQuickActionsModal } from './openQuickActionsModal';

/**
 * Opens the quick actions picker modal for the given vault file or folder.
 * On selection, delegates to `launchQuickAction` which prompts for provider
 * and model (with last-used preset) before dispatching the run. Skills tab
 * routing is owned by `openQuickActionsModal` and `runVaultSkill`.
 */
export function openContextMenuQuickAction(
  plugin: SpecoratorPlugin,
  file: TAbstractFile,
): void {
  openQuickActionsModal(plugin, {
    file,
    onRun: (action) => {
      void launchQuickAction(plugin, file, action);
    },
  });
}
