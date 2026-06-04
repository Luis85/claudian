import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import { asSettingsBag } from '../../../core/types/settings';
import type ClaudianPlugin from '../../../main';
import type { ProviderRecord } from './types';

/**
 * Builds a `ProviderRecord` for every registered provider that exposes a
 * command catalog. Used by the Skills tab aggregator across all modal
 * entry points (context menu, header toolbar, per-tab toolbar).
 */
export function buildProviderRecords(plugin: ClaudianPlugin): ProviderRecord[] {
  const settings = asSettingsBag(plugin.settings);
  return ProviderRegistry.getRegisteredProviderIds().flatMap((providerId) => {
    const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
    if (!catalog) return [];
    return [{
      providerId,
      displayName: ProviderRegistry.getProviderDisplayName(providerId),
      isEnabled: ProviderRegistry.isEnabled(providerId, settings),
      commandCatalog: catalog,
    }];
  });
}
