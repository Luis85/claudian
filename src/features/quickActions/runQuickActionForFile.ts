import { Notice, type TAbstractFile, TFile, TFolder } from 'obsidian';

import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import type { QuickAction } from './types';

/**
 * Filename stem (no extension, no folder path). Used as the stable
 * identity key for usage tracking — survives moves, breaks on rename.
 */
export function quickActionStemFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '');
}

/**
 * Shared run flow used by both the quick-actions modal callback and the
 * favorite items injected into the file/folder right-click menu.
 *
 * Ensures the chat view is open, picks (or creates) a target tab, switches
 * to it FIRST so the welcome reset does not wipe the chip, then attaches
 * the right-clicked file or folder as a pill and fires the action prompt.
 */
export async function runQuickActionForFile(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
  action: QuickAction,
): Promise<void> {
  let view = plugin.getView();
  if (!view) {
    await plugin.activateView();
    view = plugin.getView();
  }
  if (!view) return;

  const tabManager = view.getTabManager();
  if (!tabManager) return;

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

  // Switch BEFORE attaching so the blank-tab welcome reset does not wipe
  // the pill. See openContextMenuQuickAction comment block for full
  // rationale.
  await tabManager.switchToTab(targetTab.id);

  if (file instanceof TFile) {
    targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
  } else if (file instanceof TFolder) {
    targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
  }

  await targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
  plugin.events.emit('usage.recorded', {
    kind: 'quickAction',
    name: quickActionStemFromPath(action.filePath),
  });
}
