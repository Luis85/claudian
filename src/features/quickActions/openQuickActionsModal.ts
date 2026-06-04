import type { TAbstractFile } from 'obsidian';

import type ClaudianPlugin from '@/main';

import { QuickActionStorage } from './QuickActionStorage';
import { buildProviderRecords } from './skills/buildProviderRecords';
import { runVaultSkill } from './skills/runVaultSkill';
import { VaultSkillAggregator } from './skills/VaultSkillAggregator';
import type { QuickAction } from './types';
import { QuickActionsModal } from './ui/QuickActionsModal';

/**
 * Options for `openQuickActionsModal`.
 *
 * - `onRun`: how to dispatch the picked quick-action prompt. Each caller
 *   decides whether to route through `runQuickAction` (creates/reuses a tab,
 *   attaches a file pill), or to send into a known target tab.
 * - `file`: optional vault file/folder forwarded to `runVaultSkill` when the
 *   user picks a skill on the Skills tab. `null`/undefined means no pill.
 * - `onFavoritesChanged`: invoked after a favorite toggle inside the modal so
 *   the plugin's `QuickActionFavoritesCache` can re-emit the workspace menu.
 *   Defaults to refreshing the shared cache; every callsite wants the same
 *   wiring so the default keeps callers from drifting.
 */
export interface OpenQuickActionsModalOptions {
  onRun: (action: QuickAction) => void;
  file?: TAbstractFile | null;
  onFavoritesChanged?: () => void;
}

/**
 * Single construction site for the Quick Actions modal. Builds the shared
 * `QuickActionStorage`, `VaultSkillAggregator` (wired to the plugin logger),
 * and Skills-tab routing, so every modal entry point (context menu, header
 * toolbar, per-tab toolbar) gets identical wiring — no fourth-site drift.
 */
export function openQuickActionsModal(
  plugin: ClaudianPlugin,
  options: OpenQuickActionsModalOptions,
): void {
  const storage = new QuickActionStorage(
    plugin.storage.getAdapter(),
    () => plugin.settings.quickActionsFolder ?? 'Quick Actions',
  );
  const aggregator = new VaultSkillAggregator(
    () => buildProviderRecords(plugin),
    { logger: plugin.logger },
  );
  const file = options.file ?? null;

  new QuickActionsModal(plugin.app, {
    storage,
    aggregator,
    onRun: options.onRun,
    onRunSkill: (entry) => {
      void runVaultSkill(plugin, entry, file);
    },
    onFavoritesChanged:
      options.onFavoritesChanged ?? (() => plugin.quickActionFavoritesCache?.refresh()),
  }).open();
}
