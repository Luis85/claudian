import type { Menu, TAbstractFile } from 'obsidian';

import { t } from '../../i18n/i18n';
import type ClaudianPlugin from '../../main';
import { launchQuickAction } from './launchQuickAction';
import { openContextMenuQuickAction } from './openContextMenuQuickAction';

/**
 * Append the shared "picker + favorites" quick-action block to a `Menu`.
 *
 * Used by every site that adds quick-action entries to an Obsidian menu:
 *   - workspace file/folder context menu (`registerWorkspaceMenus`)
 *   - Agent Board work-order card right-click menu (`WorkOrderContextMenu`)
 *
 * Layout:
 *   - the picker entry (`zap` icon, `t('quickActions.contextMenu.title')`)
 *   - one item per cached favorite (`fav.icon` or `'star'` fallback), in
 *     `QuickActionFavoritesCache` order
 *
 * The caller is responsible for any separator placed BEFORE this block and
 * for any gating (the WO card hides the entire block when `status === 'running'`
 * or the WO note is unresolvable).
 *
 * No-ops cleanly when `plugin.quickActionFavoritesCache` is undefined — the
 * picker entry is still appended so the surface stays reachable.
 */
export function appendQuickActionFavoritesAndPicker(
  menu: Menu,
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): void {
  menu.addItem((item) => item
    .setTitle(t('quickActions.contextMenu.title'))
    .setIcon('zap')
    .onClick(() => { openContextMenuQuickAction(plugin, file); }));

  const favs = plugin.quickActionFavoritesCache?.getFavorites() ?? [];
  for (const fav of favs) {
    menu.addItem((item) => item
      .setTitle(fav.name)
      .setIcon(fav.icon ?? 'star')
      .onClick(() => { void launchQuickAction(plugin, file, fav); }));
  }
}
