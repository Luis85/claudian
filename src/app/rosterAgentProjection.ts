import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import type { ProviderId } from '../core/providers/types';
import type { VaultFileAdapter } from '../core/storage/VaultFileAdapter';
import type { RosterAgent } from '../features/agents/roster/rosterTypes';

/**
 * Projects provider-neutral roster agents into each provider's native subagent
 * convention folder so they become @-mentionable subagents the provider loads
 * itself. Each provider owns its own serialization via
 * `ProviderRegistry.projectRosterAgent`, so the app never touches provider
 * internals. Only identity + instructions are mapped — tools/models stay the
 * subagent's inherited defaults so a projected file can't strip built-in tools
 * or carry a model id the target provider doesn't recognize.
 */

function rosterSlug(agent: RosterAgent): string {
  return agent.id.startsWith('roster:') ? agent.id.slice('roster:'.length) : agent.id;
}

export interface RosterProjectionResult {
  written: number;
  providers: ProviderId[];
}

/**
 * Writes every roster agent into every given provider's native folder. Returns
 * the count written and the providers actually touched (those with a mapping).
 */
export async function projectRosterAgentsToProviders(
  agents: RosterAgent[],
  providerIds: ProviderId[],
  adapter: VaultFileAdapter,
): Promise<RosterProjectionResult> {
  let written = 0;
  const touched: ProviderId[] = [];
  for (const providerId of providerIds) {
    let projectedAny = false;
    for (const agent of agents) {
      const file = ProviderRegistry.projectRosterAgent(
        providerId,
        {
          name: agent.name,
          description: agent.description,
          prompt: agent.prompt,
          skills: agent.skills,
          color: agent.color,
        },
        rosterSlug(agent),
      );
      if (!file) continue;
      await adapter.write(file.path, file.content);
      written += 1;
      projectedAny = true;
    }
    if (projectedAny) touched.push(providerId);
  }
  return { written, providers: touched };
}
