import type { ProviderId } from '../../core/providers/types';
import type { ClaudianSettings } from '../../core/types/settings';

const ORDER: ProviderId[] = ['claude', 'codex', 'opencode', 'cursor'];

function isEnabled(s: ClaudianSettings, id: ProviderId): boolean {
  const cfg = s.providerConfigs?.[id] as { enabled?: boolean } | undefined;
  return Boolean(cfg?.enabled);
}

export function resolveAgentBoardDefaultProvider(s: ClaudianSettings): ProviderId | null {
  const stored = (s.agentBoardDefaultProvider ?? null) as ProviderId | null;
  if (stored && isEnabled(s, stored)) return stored;
  for (const id of ORDER) if (isEnabled(s, id)) return id;
  return null;
}
