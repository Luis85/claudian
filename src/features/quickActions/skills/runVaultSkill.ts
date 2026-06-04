import { Notice, type TAbstractFile, TFile, TFolder } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderId } from '@/core/providers/types';
import { asSettingsBag } from '@/core/types/settings';
import { getTabProviderId } from '@/features/chat/tabs/providerResolution';
import type { TabManager } from '@/features/chat/tabs/TabManager';
import type { TabData } from '@/features/chat/tabs/types';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import type { SkillTabEntry } from './types';

/**
 * Routes execution of a vault skill to a chat tab matching the skill's
 * provider, attaches the optional file/folder as a context pill, and sends
 * the provider-native skill invocation (`$name` or `/name`).
 *
 * Provider-enable state is re-checked at execution time via
 * `ProviderRegistry.isEnabled` — `SkillTabEntry.providerEnabled` is a
 * listing-time cache for picker dimming, so a provider toggled while the
 * modal was open must not silently send into a disabled provider, and a
 * provider re-enabled while the modal was open must not silently fail.
 *
 * Tab routing order:
 * 1. Active tab matches provider and is blank → reuse.
 * 2. Active tab matches provider but is not blank → create new tab.
 * 3. Active tab provider mismatches:
 *    a. Another blank tab on the target provider exists → reuse it.
 *    b. Else → create new tab with `defaultProviderId`.
 *
 * Pill attach MUST happen AFTER switchToTab — initializeWelcome on a blank
 * tab wipes any pill attached before the switch. See openContextMenuQuickAction
 * for the same ordering rationale.
 */
export async function runVaultSkill(
  plugin: ClaudianPlugin,
  entry: SkillTabEntry,
  file: TAbstractFile | null,
): Promise<void> {
  const enabledNow = ProviderRegistry.isEnabled(
    entry.providerId,
    asSettingsBag(plugin.settings),
  );
  if (!enabledNow) {
    new Notice(
      t('quickActions.skills.providerDisabled', { provider: entry.providerDisplayName }),
    );
    return;
  }

  let view = plugin.getView();
  if (!view) {
    await plugin.activateView();
    view = plugin.getView();
  }
  if (!view) return;

  const tabManager = view.getTabManager();
  if (!tabManager) return;

  const target = await resolveTargetTab(tabManager, plugin, entry.providerId);
  if (!target) {
    new Notice(t('quickActions.contextMenu.tabLimitReached'));
    return;
  }

  await tabManager.switchToTab(target.id);

  if (file instanceof TFile) {
    target.ui.fileContextManager?.attachFileAsPill(file.path);
  } else if (file instanceof TFolder) {
    target.ui.fileContextManager?.attachFolderAsPill(file.path);
  }

  const content = `${entry.insertPrefix}${entry.name}`;
  void target.controllers.inputController?.sendMessage({ content });
}

async function resolveTargetTab(
  tabManager: TabManager,
  plugin: ClaudianPlugin,
  targetProviderId: ProviderId,
): Promise<TabData | null> {
  const activeTab = tabManager.getActiveTab();

  if (activeTab) {
    const activeProvider = getTabProviderId(activeTab, plugin);
    if (activeProvider === targetProviderId) {
      if (activeTab.lifecycleState === 'blank') {
        return activeTab;
      }
      return createTabForProvider(tabManager, targetProviderId);
    }
  }

  // Active tab provider mismatches (or no active tab). Look for an existing
  // blank tab on the target provider before creating a new one.
  const blankMatch = tabManager.getAllTabs().find((tab) => {
    if (tab.lifecycleState !== 'blank') return false;
    return getTabProviderId(tab, plugin) === targetProviderId;
  });
  if (blankMatch) {
    return blankMatch;
  }

  return createTabForProvider(tabManager, targetProviderId);
}

async function createTabForProvider(
  tabManager: TabManager,
  providerId: ProviderId,
): Promise<TabData | null> {
  if (!tabManager.canCreateTab()) {
    return null;
  }
  const created = await tabManager.createTab(null, undefined, {
    activate: false,
    defaultProviderId: providerId,
  });
  return created ?? null;
}
