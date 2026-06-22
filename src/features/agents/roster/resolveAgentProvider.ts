import type { ProviderId } from '../../../core/providers/types';
import type { RosterAgent } from './rosterTypes';

type ProviderPreference = Pick<RosterAgent, 'providerOverride' | 'modelSelection'>;

/**
 * The provider an agent prefers: its explicit `providerOverride`, else the
 * provider implied by its model selection. Undefined when neither is set.
 */
export function agentPreferredProviderId(agent: ProviderPreference): ProviderId | undefined {
  return agent.providerOverride ?? agent.modelSelection?.providerId;
}

/**
 * The provider an agent should run on: its preferred provider when set and
 * enabled, otherwise the supplied fallback (the active/default enabled provider).
 * This prevents defaulting to a disabled provider that would error on launch.
 */
export function resolveAgentProvider(
  agent: ProviderPreference,
  isEnabled: (provider: ProviderId) => boolean,
  fallback: ProviderId,
): ProviderId {
  const preferred = agentPreferredProviderId(agent);
  return preferred && isEnabled(preferred) ? preferred : fallback;
}
