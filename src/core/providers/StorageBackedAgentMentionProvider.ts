import type { AgentMentionProvider, AgentMentionSource } from './types';

/**
 * Shared `@`-mention provider over a vault subagent store. Providers supply
 * their definition type, an optional mentionability filter (e.g. Opencode
 * hides non-subagent or disabled definitions), and an optional source
 * resolver (e.g. Cursor labels builtin/global/vault).
 */
export class StorageBackedAgentMentionProvider<
  T extends { name: string; description: string },
> implements AgentMentionProvider {
  private agents: T[] = [];

  constructor(
    private readonly storage: { loadAll(): Promise<T[]> },
    private readonly isMentionable: (agent: T) => boolean = () => true,
    private readonly resolveSource: (agent: T) => AgentMentionSource = () => 'vault',
  ) {}

  async loadAgents(): Promise<void> {
    this.agents = await this.storage.loadAll();
  }

  searchAgents(query: string): Array<{
    id: string;
    name: string;
    description?: string;
    source: AgentMentionSource;
  }> {
    const q = query.toLowerCase();
    return this.agents
      .filter((agent) => this.isMentionable(agent))
      .filter((agent) => (
        agent.name.toLowerCase().includes(q) ||
        agent.description.toLowerCase().includes(q)
      ))
      .map((agent) => ({
        id: agent.name,
        name: agent.name,
        description: agent.description,
        source: this.resolveSource(agent),
      }));
  }
}
