import type { ClaudianEventMap } from '../../../app/events/claudianEvents';
import type { EventBus } from '../../../core/events/EventBus';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { RosterAgent } from './rosterTypes';

export const ROSTER_DIR = '.claudian/agents';

function fileNameForId(id: string): string {
  const slug = id.startsWith('roster:') ? id.slice('roster:'.length) : id;
  return `${ROSTER_DIR}/${slug}.json`;
}

export class AgentRosterStore {
  constructor(
    private readonly adapter: VaultFileAdapter,
    private readonly events?: EventBus<ClaudianEventMap>,
  ) {}

  async list(): Promise<RosterAgent[]> {
    const paths = await this.adapter.listFiles(ROSTER_DIR);
    const agents: RosterAgent[] = [];
    for (const path of paths) {
      if (!path.endsWith('.json')) continue;
      try {
        agents.push(JSON.parse(await this.adapter.read(path)) as RosterAgent);
      } catch {
        // skip malformed files; the editor surfaces validation elsewhere
      }
    }
    return agents.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<RosterAgent | null> {
    const path = fileNameForId(id);
    if (!(await this.adapter.exists(path))) return null;
    try {
      return JSON.parse(await this.adapter.read(path)) as RosterAgent;
    } catch {
      return null;
    }
  }

  async save(agent: RosterAgent): Promise<void> {
    // VaultFileAdapter.write ensures the parent folder, so no explicit ensureFolder.
    await this.adapter.write(fileNameForId(agent.id), JSON.stringify(agent, null, 2));
    this.events?.emit('roster:changed');
  }

  async delete(id: string): Promise<void> {
    const path = fileNameForId(id);
    if (!(await this.adapter.exists(path))) return;
    await this.adapter.delete(path);
    this.events?.emit('roster:changed');
  }
}
