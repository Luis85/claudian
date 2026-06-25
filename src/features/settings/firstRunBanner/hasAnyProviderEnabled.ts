import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { SpecoratorSettings } from '../../../core/types/settings';

export function hasAnyProviderEnabled(settings: SpecoratorSettings): boolean {
  for (const id of ProviderRegistry.getRegisteredProviderIds()) {
    const cfg = settings.providerConfigs?.[id] as { enabled?: boolean } | undefined;
    if (cfg?.enabled) return true;
  }
  return false;
}
