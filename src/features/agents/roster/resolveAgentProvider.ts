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

/**
 * The model an agent's run should use on a *resolved* provider. A saved model id
 * is provider-specific (a Codex model id is meaningless to Cursor/Claude), so it
 * only applies when the selection's provider matches the provider the run will
 * actually use; otherwise the run falls back to that provider's own default,
 * preventing a cross-provider model id from leaking after a disabled-provider
 * fallback. `providerDefault` may be `undefined` to let the runtime pick its own.
 */
export function resolveAgentModelForProvider(
  agent: Pick<RosterAgent, 'modelSelection'>,
  providerId: ProviderId,
  providerDefault: string | undefined,
): string | undefined {
  const selection = agent.modelSelection;
  return selection && selection.providerId === providerId
    ? selection.modelId
    : providerDefault;
}
