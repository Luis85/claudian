import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { buildAgentOptions, buildPersonaResolverFromAgents, type PersonaResolver } from '../../agents/personaRegistry';
import type { RosterAgent } from '../../agents/roster/rosterTypes';

interface WorkOrderOption { value: string; label: string }

export interface WorkOrderFieldOptions {
  getProviderOptions: () => WorkOrderOption[];
  getModelOptions: (providerId: string) => WorkOrderOption[];
  getAgentOptions: () => WorkOrderOption[];
  resolvePersona: PersonaResolver;
}

/**
 * Builds the provider / model / agent option getters plus the persona resolver
 * shared by the two work-order detail modal call sites (the Agent Board view and
 * the chat-header activity provider). Both must offer the same enabled-provider
 * list, model options, and preloaded roster, so the bundle lives in one place to
 * keep them from drifting.
 */
export function buildWorkOrderFieldOptions(
  settings: Record<string, unknown>,
  agents: RosterAgent[],
): WorkOrderFieldOptions {
  return {
    getProviderOptions: () =>
      ProviderRegistry.getEnabledProviderIds(settings).map((id) => ({ value: id, label: id })),
    getModelOptions: (providerId) =>
      ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId)
        ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
        : [],
    getAgentOptions: () => buildAgentOptions(agents),
    resolvePersona: buildPersonaResolverFromAgents(agents),
  };
}
