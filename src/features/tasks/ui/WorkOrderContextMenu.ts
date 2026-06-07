import { Menu, TFile } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { launchQuickAction } from '../../quickActions/launchQuickAction';
import { openContextMenuQuickAction } from '../../quickActions/openContextMenuQuickAction';
import type { TaskSpec } from '../model/taskTypes';

// Statuses that show the Archive action. Terminal statuses retire to the
// archive folder; `inbox` is included so triage can clear stale captures the
// same way without first transitioning the WO through `ready`.
const ARCHIVABLE_STATUSES: ReadonlySet<TaskSpec['frontmatter']['status']> = new Set([
  'inbox',
  'done',
  'failed',
  'canceled',
]);

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
  /** Invoked when the user clicks Archive (terminal status or inbox). */
  onArchive: (task: TaskSpec) => void;
  /** Invoked when the user clicks Delete on an inbox card. */
  onDelete: (task: TaskSpec) => void;
}

/**
 * Build and show the right-click context menu for a work-order card on the
 * Agent Board.
 *
 * Layout (no separator is emitted for an empty section, so the menu stays
 * tight when nothing is configured):
 *
 *   1. Top section — Open note, Open conversation (gated), Open Quick Actions
 *      (the picker, gated by `canPromptOn`).
 *   2. Favorites section — `quickActionFavoritesCache` entries, bracketed by a
 *      leading AND trailing separator. Hidden entirely (no separators) when
 *      either `canPromptOn` is false or the cache yields no favorites.
 *   3. Bottom section — Archive (terminal status or inbox) plus Delete (inbox
 *      only). Sits directly under the previous section — the favorites'
 *      trailing separator (when present) already provides the visual break.
 *
 * `canPromptOn` is false when `status === 'running'` (avoid surprise
 * side-prompts on an active run) or when the work-order note path no longer
 * resolves to a TFile (deleted/moved or shadowed by a TFolder of the same
 * path). Both the picker and the favorites depend on it because they all act
 * on the same WO file.
 *
 * Unlike the workspace file/folder menu (which still routes through
 * `appendQuickActionFavoritesAndPicker`), this menu inlines the picker + favs
 * so the picker can move into the top navigation section while favorites form
 * their own bracketed group.
 */
export function showWorkOrderContextMenu(
  task: TaskSpec,
  event: MouseEvent,
  deps: WorkOrderContextMenuDeps,
): void {
  const { plugin, onOpenNote, onOpenConversation, canOpenConversation, onArchive, onDelete } = deps;
  const menu = new Menu();

  const status = task.frontmatter.status;
  const isRunning = status === 'running';
  const abstract = plugin.app.vault.getAbstractFileByPath(task.path);
  const workOrderFile = abstract instanceof TFile ? abstract : null;
  const canPromptOn = !isRunning && workOrderFile !== null;
  const favorites = canPromptOn
    ? plugin.quickActionFavoritesCache?.getFavorites() ?? []
    : [];

  // --- Top section: navigation + picker ---
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

  if (canPromptOn && workOrderFile) {
    menu.addItem((item) => item
      .setTitle(t('quickActions.contextMenu.title'))
      .setIcon('zap')
      .onClick(() => { openContextMenuQuickAction(plugin, workOrderFile); }));
  }

  // --- Favorites section: bracketed by separators only when populated ---
  if (canPromptOn && workOrderFile && favorites.length > 0) {
    menu.addSeparator();
    for (const fav of favorites) {
      menu.addItem((item) => item
        .setTitle(fav.name)
        .setIcon(fav.icon ?? 'star')
        .onClick(() => { void launchQuickAction(plugin, workOrderFile, fav); }));
    }
    menu.addSeparator();
  }

  // --- Bottom section: archive (+ delete on inbox) ---
  if (ARCHIVABLE_STATUSES.has(status)) {
    menu.addItem((item) => item
      .setTitle(t('tasks.board.contextMenu.archive'))
      .setIcon('archive')
      .onClick(() => onArchive(task)));
  }

  if (status === 'inbox') {
    menu.addItem((item) => item
      .setTitle(t('tasks.board.contextMenu.delete'))
      .setIcon('trash-2')
      .onClick(() => onDelete(task)));
  }

  menu.showAtMouseEvent(event);
}
