import { Menu, TFile } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { appendQuickActionFavoritesAndPicker } from '../../quickActions/appendQuickActionMenu';
import type { TaskSpec } from '../model/taskTypes';

export interface WorkOrderContextMenuDeps {
  plugin: ClaudianPlugin;
  onOpenNote: (task: TaskSpec) => void;
  onOpenConversation: (task: TaskSpec) => void;
  /**
   * Returns true when Open conversation should be visible. The composed gate
   * (`conversation_id` present AND `getConversationSync(id)` resolves) lives in
   * `buildWorkOrderConversationBindings` so both this menu and the
   * `WorkOrderDetailModal` share one source of truth.
   */
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
 *   - the work-order note path no longer resolves to a TFile (deleted/moved
 *     or shadowed by a TFolder of the same path).
 *
 * Favorites + picker are delegated to `appendQuickActionFavoritesAndPicker` so
 * this surface stays aligned with the workspace file/folder menu (one helper,
 * one layout, one click semantics).
 */
export function showWorkOrderContextMenu(
  task: TaskSpec,
  event: MouseEvent,
  deps: WorkOrderContextMenuDeps,
): void {
  const { plugin, onOpenNote, onOpenConversation, canOpenConversation } = deps;
  const menu = new Menu();

  menu.addItem((item) => item
    .setTitle(t('tasks.board.contextMenu.openNote'))
    .setIcon('file-text')
    .onClick(() => onOpenNote(task)));

  if (canOpenConversation(task)) {
    menu.addItem((item) => item
      .setTitle(t('tasks.board.contextMenu.openConversation'))
      .setIcon('messages-square')
      .onClick(() => onOpenConversation(task)));
  }

  const isRunning = task.frontmatter.status === 'running';
  const abstract = plugin.app.vault.getAbstractFileByPath(task.path);
  const workOrderFile = abstract instanceof TFile ? abstract : null;
  const canPromptOn = !isRunning && workOrderFile !== null;

  if (canPromptOn) {
    menu.addSeparator();
    appendQuickActionFavoritesAndPicker(menu, plugin, workOrderFile);
  }

  menu.showAtMouseEvent(event);
}
