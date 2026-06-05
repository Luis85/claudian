import { Menu, TFile } from 'obsidian';

import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
import { runQuickActionForFile } from '@/features/quickActions/runQuickActionForFile';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import type { TaskSpec } from '../model/taskTypes';

export interface WorkOrderContextMenuDeps {
  plugin: ClaudianPlugin;
  onOpenNote: (task: TaskSpec) => void;
  onOpenConversation: (task: TaskSpec) => void;
  canOpenConversation: (task: TaskSpec) => boolean;
}

/**
 * Build and show the right-click context menu for a work-order card on the
 * Agent Board.
 *
 * Always shows: Open note. Shows Open conversation only when the caller's
 * `canOpenConversation` gate returns true (mirrors the WorkOrderDetailModal
 * gate so we don't list broken navigation).
 *
 * Quick-action items (favorites + picker) are hidden when:
 *   - status === 'running' (avoid surprise side-prompts on an active run), OR
 *   - the work-order note path no longer resolves to a TFile (deleted/moved).
 *
 * Favorites come from the plugin-lifetime `QuickActionFavoritesCache`. Click
 * handlers delegate to `runQuickActionForFile` / `openContextMenuQuickAction`
 * with the WO note as the file argument so the existing tab-routing and pill
 * attach flow is reused unchanged.
 */
export function showWorkOrderContextMenu(
  task: TaskSpec,
  event: MouseEvent,
  deps: WorkOrderContextMenuDeps,
): void {
  const { plugin, onOpenNote, onOpenConversation, canOpenConversation } = deps;
  const menu = new Menu();

  menu.addItem((i) => i
    .setTitle(t('tasks.board.contextMenu.openNote'))
    .setIcon('file-text')
    .onClick(() => onOpenNote(task)));

  if (canOpenConversation(task)) {
    menu.addItem((i) => i
      .setTitle(t('tasks.board.contextMenu.openConversation'))
      .setIcon('messages-square')
      .onClick(() => onOpenConversation(task)));
  }

  const isRunning = task.frontmatter.status === 'running';
  const abstract = plugin.app.vault.getAbstractFileByPath(task.path);
  const woTFile = abstract instanceof TFile ? abstract : null;
  const canPromptOn = !isRunning && woTFile !== null;

  if (canPromptOn) {
    const favs = plugin.quickActionFavoritesCache?.getFavorites() ?? [];
    menu.addSeparator();
    for (const fav of favs) {
      menu.addItem((i) => i
        .setTitle(fav.name)
        .setIcon(fav.icon ?? 'star')
        .onClick(() => { void runQuickActionForFile(plugin, woTFile, fav); }));
    }
    menu.addItem((i) => i
      .setTitle(t('quickActions.contextMenu.title'))
      .setIcon('zap')
      .onClick(() => openContextMenuQuickAction(plugin, woTFile)));
  }

  menu.showAtMouseEvent(event);
}
