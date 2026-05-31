import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId, ProviderUIOption } from '../../../core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../../core/providers/types';

/**
 * Returns model options for a blank tab.
 * Uses provider registration metadata to determine which providers are
 * available and how they should appear in the mixed picker.
 */
export function getBlankTabModelOptions(
  settings: Record<string, unknown>,
): ProviderUIOption[] {
  return ProviderRegistry.getEnabledProviderIds(settings).flatMap((providerId) => {
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const providerIcon = uiConfig.getProviderIcon?.() ?? undefined;
    const group = ProviderRegistry.getProviderDisplayName(providerId);

    return uiConfig.getModelOptions(settings)
      .map(model => ({ ...model, group, providerIcon }));
  });
}

/**
 * Resolves the default provider for a blank/first tab when no draft model
 * dictates the provider. Prefers the active settings provider when it is
 * enabled, otherwise the first enabled provider by blank-tab order.
 */
export function resolveBlankTabDefaultProviderId(settings: Record<string, unknown>): ProviderId {
  const current = settings.settingsProvider;
  if (typeof current === 'string'
    && ProviderRegistry.getRegisteredProviderIds().includes(current as ProviderId)
    && ProviderRegistry.isEnabled(current as ProviderId, settings)) {
    return current as ProviderId;
  }
  return ProviderRegistry.getEnabledProviderIds(settings)[0] ?? DEFAULT_CHAT_PROVIDER_ID;
}
