import type { Menu, TAbstractFile } from 'obsidian';

import { t } from '../../i18n/i18n';
import type ClaudianPlugin from '../../main';
import { launchQuickAction } from './launchQuickAction';
import { openContextMenuQuickAction } from './openContextMenuQuickAction';

/**
 * Append the shared "picker + favorites" quick-action block to a `Menu`.
 *
 * Used by the workspace file/folder context menu (`registerWorkspaceMenus`).
 * The Agent Board WO card menu used to share this helper too but now inlines
 * its own variant because it needs the picker inside its top navigation
 * section rather than next to the favorites — see
 * `features/tasks/ui/WorkOrderContextMenu.ts`.
 *
 * Layout:
 *   - the picker entry (`zap` icon, `t('quickActions.contextMenu.title')`)
 *   - when one or more favorites are cached:
 *       leading separator → one item per favorite (cache order) → trailing
 *       separator
 *
 * The leading + trailing separators around the favorites set are emitted only
 * when at least one favorite exists, so the menu stays tight when the cache is
 * empty (or missing) and distinct from the picker-and-native items when it is
 * not. This mirrors the WO card menu's "user-generated items get their own
 * bracketed group" treatment.
 *
 * The caller is responsible for any separator placed BEFORE this block. The
 * return value tells the caller how many favorites were appended; the
 * workspace menu uses this to decide whether to add a trailing outer separator
 * (already provided by the favorites' trailing separator when favs > 0).
 *
 * No-ops cleanly when `plugin.quickActionFavoritesCache` is undefined — the
 * picker entry is still appended so the surface stays reachable, and the
 * favorites separators are skipped (returns 0).
 */
export function appendQuickActionFavoritesAndPicker(
  menu: Menu,
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): number {
  menu.addItem((item) => item
    .setTitle(t('quickActions.contextMenu.title'))
    .setIcon('zap')
    .onClick(() => { openContextMenuQuickAction(plugin, file); }));

  const favs = plugin.quickActionFavoritesCache?.getFavorites() ?? [];
  if (favs.length === 0) return 0;

  menu.addSeparator();
  for (const fav of favs) {
    menu.addItem((item) => item
      .setTitle(fav.name)
      .setIcon(fav.icon ?? 'star')
      .onClick(() => { void launchQuickAction(plugin, file, fav); }));
  }
  menu.addSeparator();
  return favs.length;
}
