import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { AgentRosterStore, ROSTER_DIR } from '@/features/agents/roster/AgentRosterStore';
import { createRosterAgent } from '@/features/agents/roster/rosterCapabilities';

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

describe('AgentRosterStore', () => {
  it('saves an agent as JSON under the roster dir', async () => {
    const files: Record<string, string> = {};
    const adapter = makeAdapter(files);
    const store = new AgentRosterStore(adapter);
    const agent = createRosterAgent('Reviewer', 1);

    await store.save(agent);

    expect(adapter.write).toHaveBeenCalledWith(
      `${ROSTER_DIR}/reviewer.json`,
      expect.stringContaining('"name": "Reviewer"'),
    );
    expect(files[`${ROSTER_DIR}/reviewer.json`]).toContain('"name": "Reviewer"');
  });

  it('lists saved agents', async () => {
    const agent = createRosterAgent('Reviewer', 1);
    const files = { [`${ROSTER_DIR}/reviewer.json`]: JSON.stringify(agent) };
    const store = new AgentRosterStore(makeAdapter(files));

    const all = await store.list();

    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('roster:reviewer');
  });

  it('skips malformed json files', async () => {
    const files = { [`${ROSTER_DIR}/bad.json`]: '{not json' };
    const store = new AgentRosterStore(makeAdapter(files));
    await expect(store.list()).resolves.toEqual([]);
  });

  it('deletes an agent by id', async () => {
    const agent = createRosterAgent('Reviewer', 1);
    const files = { [`${ROSTER_DIR}/reviewer.json`]: JSON.stringify(agent) };
    const adapter = makeAdapter(files);
    const store = new AgentRosterStore(adapter);

    await store.delete('roster:reviewer');

    expect(adapter.delete).toHaveBeenCalledWith(`${ROSTER_DIR}/reviewer.json`);
  });

  it('does not delete or emit when the agent is absent', async () => {
    const adapter = makeAdapter({});
    const emit = jest.fn();
    const store = new AgentRosterStore(adapter, { emit } as never);

    await store.delete('roster:ghost');

    expect(adapter.delete).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
