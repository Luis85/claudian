import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../core/providers/types';
import type { SpecoratorSettings } from '../../core/types/settings';

function isEnabled(s: SpecoratorSettings, id: ProviderId): boolean {
  const cfg = s.providerConfigs?.[id] as { enabled?: boolean } | undefined;
  return Boolean(cfg?.enabled);
}

export function resolveAgentBoardDefaultProvider(s: SpecoratorSettings): ProviderId | null {
  const stored = (s.agentBoardDefaultProvider ?? null) as ProviderId | null;
  if (stored && isEnabled(s, stored)) return stored;
  // Iterate registration order — matches the historical preference
  // (claude > codex > opencode > cursor) without a hardcoded ORDER list.
  for (const id of ProviderRegistry.getRegisteredProviderIds()) {
    if (isEnabled(s, id)) return id;
  }
  return null;
}
