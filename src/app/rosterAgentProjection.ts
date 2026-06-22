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
  const raw = agent.id.startsWith('roster:') ? agent.id.slice('roster:'.length) : agent.id;
  // Defense-in-depth: the id comes from on-disk JSON a synced/crafted file could
  // control, so re-slugify to `[a-z0-9-]` — never trust it for path math.
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Collapses a free-text field to a safe single line so it can't inject extra
 *  frontmatter keys (newlines) when serialized into a provider agent file. */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface RosterProjectionResult {
  written: number;
  providers: ProviderId[];
  /** Names of agents whose projection failed or was skipped (per-agent isolation). */
  failed: string[];
}

type ProjectionOutcome = 'written' | 'no-mapping' | { failed: string };

/**
 * Projects one agent into one provider. Sanitizes the slug/name first (skipping
 * unsafe or blank input that's only reachable via a hand-edited roster JSON) and
 * isolates a write failure so the caller can keep going.
 */
async function projectAgentToProvider(
  providerId: ProviderId,
  agent: RosterAgent,
  adapter: VaultFileAdapter,
  onError?: (provider: ProviderId, agentName: string, error: unknown) => void,
): Promise<ProjectionOutcome> {
  const slug = rosterSlug(agent);
  const name = singleLine(agent.name);
  if (!slug || !name) return { failed: name || agent.id };
  try {
    const file = ProviderRegistry.projectRosterAgent(
      providerId,
      { name, description: singleLine(agent.description), prompt: agent.prompt, skills: agent.skills, color: agent.color },
      slug,
    );
    if (!file) return 'no-mapping';
    await adapter.write(file.path, file.content);
    return 'written';
  } catch (error) {
    onError?.(providerId, name || agent.id, error);
    return { failed: name || agent.id };
  }
}

/**
 * Writes every roster agent into every given provider's native folder. Returns
 * the count written, the providers actually touched (those with a mapping), and
 * any agents skipped/failed (a single failure doesn't abort the rest).
 */
export async function projectRosterAgentsToProviders(
  agents: RosterAgent[],
  providerIds: ProviderId[],
  adapter: VaultFileAdapter,
  onError?: (provider: ProviderId, agentName: string, error: unknown) => void,
): Promise<RosterProjectionResult> {
  let written = 0;
  const touched: ProviderId[] = [];
  const failed = new Set<string>();
  for (const providerId of providerIds) {
    let projectedAny = false;
    for (const agent of agents) {
      const outcome = await projectAgentToProvider(providerId, agent, adapter, onError);
      if (outcome === 'written') {
        written += 1;
        projectedAny = true;
      } else if (outcome !== 'no-mapping') {
        failed.add(outcome.failed);
      }
    }
    if (projectedAny) touched.push(providerId);
  }
  return { written, providers: touched, failed: [...failed] };
}
