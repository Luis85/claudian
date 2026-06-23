import { getEnabledProviderForModel } from '../../../core/providers/modelRouting';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types/settings';
import type SpecoratorPlugin from '../../../main';
import {
  applyProviderUIGating,
  cleanupTabRuntime,
  getTabHiddenCommands,
  refreshTabProviderUI,
  syncTabProviderServices,
} from './tabShared';
import type { TabData } from './types';

/**
 * Called when provider availability changes. If a blank tab targets a provider
 * that is now disabled, it falls back to the first enabled provider's default
 * blank-tab model. Refreshes model selector options for all blank tabs.
 */
export async function onProviderAvailabilityChanged(
  tab: TabData,
  plugin: SpecoratorPlugin,
): Promise<void> {
  if (tab.lifecycleState !== 'blank') return;

  const settingsSnapshot = asSettingsBag(plugin.settings);
  const enabledProviderIds = ProviderRegistry.getEnabledProviderIds(settingsSnapshot);
  let nextProviderId = tab.providerId;

  if (tab.draftModel) {
    const draftProvider = getEnabledProviderForModel(tab.draftModel, settingsSnapshot);
    const draftProviderOwnsModel = ProviderRegistry
      .getChatUIConfig(draftProvider)
      .ownsModel(tab.draftModel, settingsSnapshot);
    if (!enabledProviderIds.includes(draftProvider) || !draftProviderOwnsModel) {
      const fallbackProviderId = enabledProviderIds[0] ?? DEFAULT_CHAT_PROVIDER_ID;
      const fallbackModels = ProviderRegistry.getChatUIConfig(fallbackProviderId)
        .getModelOptions(settingsSnapshot);
      tab.draftModel = fallbackModels[0]?.value ?? tab.draftModel;
      nextProviderId = fallbackProviderId;
    } else {
      nextProviderId = draftProvider;
    }
  }

  tab.providerId = nextProviderId;

  // Clean up stale service if provider changed. Await the outgoing runtime's
  // cleanup so its CLI process has exited before the next send constructs a
  // replacement runtime for the new provider (no overlapping processes).
  if (
    tab.service
    && tab.service.providerId !== nextProviderId
  ) {
    await cleanupTabRuntime(tab);
  }

  syncTabProviderServices(tab, plugin);
  tab.ui.slashCommandDropdown?.setHiddenCommands(getTabHiddenCommands(tab, plugin));
  tab.ui.slashCommandDropdown?.resetSdkSkillsCache();
  refreshTabProviderUI(tab, plugin);
  applyProviderUIGating(tab, plugin);
}
