import type { DataAdapter } from 'obsidian';

import { RunSidecarStore } from '../../../../../src/features/tasks/storage/RunSidecarStore';

function makeFakeAdapter() {
  const files = new Map<string, string>();
  const adapter: Pick<DataAdapter, 'exists' | 'mkdir' | 'read' | 'write' | 'append'> = {
    async exists(path) { return files.has(path); },
    async mkdir(_path) { /* in-memory: no-op */ },
    async read(path) {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    },
    async write(path, data) { files.set(path, data); },
    async append(path, data) { files.set(path, (files.get(path) ?? '') + data); },
  };
  return { adapter: adapter as DataAdapter, files };
}

describe('RunSidecarStore.heartbeat', () => {
  it('round-trips a heartbeat record under .claudian/runs/<runId>/heartbeat.json', async () => {
    const { adapter, files } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await store.writeHeartbeat('run-abc', { at: '2026-06-06T12:00:00.000Z', status: 'running' });

    expect(files.get('.claudian/runs/run-abc/heartbeat.json')).toContain('"status": "running"');
    expect(await store.readHeartbeat('run-abc')).toEqual({
      at: '2026-06-06T12:00:00.000Z',
      status: 'running',
    });
  });

  it('returns null when no heartbeat exists', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    expect(await store.readHeartbeat('nope')).toBeNull();
  });
});
