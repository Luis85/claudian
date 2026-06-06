import { Notice, type TAbstractFile, TFile, TFolder } from 'obsidian';

import type { ProviderId } from '@/core/providers/types';
import { getTabProviderId } from '@/features/chat/tabs/providerResolution';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import { quickActionStemFromPath } from './quickActionStem';
import type { QuickAction } from './types';

export { quickActionStemFromPath };

/**
 * Per-run provider+model override applied to the target tab. When present, the
 * active blank tab is only reused if its current provider equals
 * `providerId`; otherwise a fresh tab is created with `defaultProviderId` +
 * `pinnedModel` so the runtime applies the chosen model on every turn.
 */
export interface QuickActionRunOverride {
  providerId: ProviderId;
  model: string;
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
  override?: QuickActionRunOverride,
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
  // When an override is present, the active blank tab is only reusable if
  // its provider matches the override — running a Claude prompt in a blank
  // Codex tab would defeat the picker.
  const overrideMatchesActive = override !== undefined && isBlank && activeTab
    ? getTabProviderId(activeTab, plugin) === override.providerId
    : false;
  let targetTab;

  if (override === undefined && isBlank && activeTab) {
    targetTab = activeTab;
  } else if (overrideMatchesActive && activeTab) {
    targetTab = activeTab;
  } else if (tabManager.canCreateTab()) {
    const newTab = await tabManager.createTab(null, undefined, {
      activate: false,
      ...(override !== undefined
        ? { defaultProviderId: override.providerId, pinnedModel: override.model }
        : {}),
    });
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
