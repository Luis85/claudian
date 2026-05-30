import type { ProviderId } from '../../../core/providers/types';
import type { ClaudianSettings } from '../../../core/types/settings';

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'opencode', 'cursor'];

export function hasAnyProviderEnabled(settings: ClaudianSettings): boolean {
  for (const id of PROVIDERS) {
    const cfg = settings.providerConfigs?.[id] as { enabled?: boolean } | undefined;
    if (cfg?.enabled) return true;
  }
  return false;
}
