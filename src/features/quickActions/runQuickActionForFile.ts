import { Notice, type TAbstractFile, TFile, TFolder } from 'obsidian';

import type { ProviderId } from '@/core/providers/types';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import type { QuickAction } from './types';

/** Per-run provider+model override (Task 6 wires the behavior). */
export interface QuickActionRunOverride {
  providerId: ProviderId;
  model: string;
}

/**
 * Filename stem (no extension, no folder path). Used as the stable
 * identity key for usage tracking — survives moves, breaks on rename.
 */
export function quickActionStemFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '');
}

/**
 * Structural shape of the target tab passed to {@link dispatchQuickActionToTab}.
 * Kept narrow so the helper does not couple to the full `TabData` type from
 * the chat slice — callers (`runQuickActionForFile`, `ClaudianView` header
 * onRun, future entry points) only need access to `inputController`.
 */
export interface QuickActionDispatchTarget {
  controllers: {
    inputController?: {
      sendMessage(options: { content: string }): Promise<unknown>;
    } | null;
  };
}

/**
 * Send a quick-action prompt into the given tab and emit `usage.recorded`
 * on resolved success. The single seam every quick-action entry point
 * funnels through: file/folder context menu, WO-card favorites, and the
 * chat-header toolbar. Centralising the send+emit pair prevents new entry
 * points from undercounting the leaderboard.
 *
 * - Skips emit if the tab has no input controller (cannot send).
 * - Skips emit if `sendMessage` rejects (no successful dispatch).
 */
export async function dispatchQuickActionToTab(
  plugin: ClaudianPlugin,
  tab: QuickActionDispatchTarget,
  action: QuickAction,
): Promise<void> {
  const inputController = tab.controllers.inputController;
  if (!inputController) return;
  await inputController.sendMessage({ content: action.prompt });
  plugin.events.emit('usage.recorded', {
    kind: 'quickAction',
    name: quickActionStemFromPath(action.filePath),
  });
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
  // TODO(Task 6): apply override to target tab provider+model before dispatch.
  _override?: QuickActionRunOverride,
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

  await dispatchQuickActionToTab(plugin, targetTab, action);
}
