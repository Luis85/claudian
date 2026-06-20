import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { AgentRosterStore, ROSTER_DIR } from '@/features/agents/roster/AgentRosterStore';
import {
  installPresetAgents,
  PRESET_AGENT_SPECS,
  presetAgentToRosterAgent,
} from '@/features/agents/roster/presetAgents';
import { rosterIdFromSlug, slugifyRosterName } from '@/features/agents/roster/rosterCapabilities';

function makeAdapter(files: Record<string, string>) {
  return {
    ensureFolder: jest.fn().mockResolvedValue(undefined),
    listFiles: jest.fn(async (dir: string) =>
      Object.keys(files).filter((p) => p.startsWith(`${dir}/`)),
    ),
    read: jest.fn(async (p: string) => files[p]),
    write: jest.fn(async (p: string, c: string) => { files[p] = c; }),
    exists: jest.fn(async (p: string) => p in files),
    delete: jest.fn(async (p: string) => { delete files[p]; }),
  } as unknown as VaultFileAdapter;
}

describe('preset agents', () => {
  it('declares well-formed, uniquely-identified specs', () => {
    const ids = PRESET_AGENT_SPECS.map((s) => rosterIdFromSlug(slugifyRosterName(s.name)));
    expect(new Set(ids).size).toBe(ids.length); // no id collisions
    for (const spec of PRESET_AGENT_SPECS) {
      expect(spec.name.trim()).not.toBe('');
      expect(spec.description.trim()).not.toBe('');
      expect(spec.prompt.trim().length).toBeGreaterThan(40);
      expect(spec.icon.trim()).not.toBe('');
      expect(spec.color).toMatch(/^var\(--/);
      expect(spec.initials).toMatch(/^[A-Z]{2}$/);
      expect(spec.roles.length).toBeGreaterThan(0);
    }
  });

  it('projects a spec into a RosterAgent with empty vault-specific grants', () => {
    const agent = presetAgentToRosterAgent(PRESET_AGENT_SPECS[0], 123);
    expect(agent.id).toBe(rosterIdFromSlug(slugifyRosterName(PRESET_AGENT_SPECS[0].name)));
    expect(agent.tools).toEqual([]);
    expect(agent.skills).toEqual([]);
    expect(agent.createdAt).toBe(123);
    expect(agent.updatedAt).toBe(123);
  });

  it('installs every preset into an empty roster', async () => {
    const files: Record<string, string> = {};
    const store = new AgentRosterStore(makeAdapter(files));

    const result = await installPresetAgents(store, 1);

    expect(result.installed).toHaveLength(PRESET_AGENT_SPECS.length);
    expect(result.skipped).toHaveLength(0);
    expect(Object.keys(files)).toHaveLength(PRESET_AGENT_SPECS.length);
  });

  it('skips presets whose id already exists (non-destructive re-run)', async () => {
    const files: Record<string, string> = {};
    const store = new AgentRosterStore(makeAdapter(files));
    await installPresetAgents(store, 1);

    const second = await installPresetAgents(store, 2);

    expect(second.installed).toHaveLength(0);
    expect(second.skipped).toHaveLength(PRESET_AGENT_SPECS.length);
  });

  it('does not clobber a user-edited preset on re-run', async () => {
    const files: Record<string, string> = {};
    const store = new AgentRosterStore(makeAdapter(files));
    await installPresetAgents(store, 1);
    const firstSpec = PRESET_AGENT_SPECS[0];
    const slug = slugifyRosterName(firstSpec.name);
    const path = `${ROSTER_DIR}/${slug}.json`;
    const edited = { ...JSON.parse(files[path]), prompt: 'user edit' };
    files[path] = JSON.stringify(edited);

    await installPresetAgents(store, 3);

    expect(JSON.parse(files[path]).prompt).toBe('user edit');
  });
});
