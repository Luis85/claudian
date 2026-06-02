import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ClaudianSettings } from '../../../core/types/settings';

export function hasAnyProviderEnabled(settings: ClaudianSettings): boolean {
  for (const id of ProviderRegistry.getRegisteredProviderIds()) {
    const cfg = settings.providerConfigs?.[id] as { enabled?: boolean } | undefined;
    if (cfg?.enabled) return true;
  }
  return false;
}
