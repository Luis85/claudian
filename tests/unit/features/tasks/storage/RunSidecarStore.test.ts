import type { DataAdapter } from 'obsidian';

import { RunSidecarStore } from '../../../../../src/features/tasks/storage/RunSidecarStore';

interface FakeAdapterOptions {
  trackMkdir?: boolean;
  rejectDuplicateMkdir?: boolean;
}

function makeFakeAdapter(options: FakeAdapterOptions = {}) {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const mkdirs: string[] = [];
  const adapter: Pick<
    DataAdapter,
    'exists' | 'mkdir' | 'read' | 'write' | 'append' | 'rmdir' | 'remove' | 'list'
  > = {
    async exists(path) { return files.has(path) || dirs.has(path); },
    async mkdir(path) {
      if (options.trackMkdir) mkdirs.push(path);
      if (options.rejectDuplicateMkdir && dirs.has(path)) {
        throw new Error('EEXIST: directory already exists');
      }
      dirs.add(path);
    },
    async read(path) {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    },
    async write(path, data) { files.set(path, data); },
    async append(path, data) { files.set(path, (files.get(path) ?? '') + data); },
    async rmdir(path, recursive) {
      if (recursive) {
        for (const key of [...files.keys()]) {
          if (key === path || key.startsWith(`${path}/`)) files.delete(key);
        }
        for (const key of [...dirs]) {
          if (key === path || key.startsWith(`${path}/`)) dirs.delete(key);
        }
      } else {
        dirs.delete(path);
      }
    },
    async remove(path) { files.delete(path); },
    async list(path) {
      const childFolders: string[] = [];
      const childFiles: string[] = [];
      const prefix = `${path}/`;
      for (const folder of dirs) {
        if (folder.startsWith(prefix) && !folder.slice(prefix.length).includes('/')) {
          childFolders.push(folder);
        }
      }
      for (const file of files.keys()) {
        if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) {
          childFiles.push(file);
        }
      }
      return { folders: childFolders, files: childFiles };
    },
  };
  return { adapter: adapter as DataAdapter, files, dirs, mkdirs };
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

  it('round-trips an optional runtimeId stamped by the caller', async () => {
    // The runtimeId identifies the plugin instance that wrote the heartbeat.
    // Orphan recovery uses a mismatch to detect "previous plugin load" sidecars
    // immediately, without waiting for the 5-minute stale window.
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await store.writeHeartbeat('run-rt', {
      at: '2026-06-06T12:00:00.000Z',
      status: 'running',
      runtimeId: 'plugin-load-abc',
    });

    expect(await store.readHeartbeat('run-rt')).toEqual({
      at: '2026-06-06T12:00:00.000Z',
      status: 'running',
      runtimeId: 'plugin-load-abc',
    });
  });
});

describe('RunSidecarStore.ledger', () => {
  it('appends JSONL entries to .claudian/runs/<runId>/ledger.jsonl', async () => {
    const { adapter, files } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await store.appendLedger('run-1', {
      timestamp: '2026-06-06T12:00:00.000Z',
      status: 'running',
      message: 'Run started (attempt 1)',
    });
    await store.appendLedger('run-1', {
      timestamp: '2026-06-06T12:00:05.000Z',
      status: 'running',
      message: 'progress: scanning files',
    });

    const raw = files.get('.claudian/runs/run-1/ledger.jsonl') as string;
    expect(raw.split('\n').filter((l) => l.length > 0)).toHaveLength(2);
    const entries = await store.readLedger('run-1');
    expect(entries.map((e) => e.message)).toEqual([
      'Run started (attempt 1)',
      'progress: scanning files',
    ]);
  });

  it('returns [] for a missing ledger file', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    expect(await store.readLedger('nope')).toEqual([]);
  });

  it('readLedger skips malformed JSONL lines and returns the rest', async () => {
    const { adapter, files } = makeFakeAdapter();
    files.set(
      '.claudian/runs/r/ledger.jsonl',
      `${JSON.stringify({ timestamp: 'a', status: 'running', message: 'one' })}\n` +
        '{ broken\n' +
        `${JSON.stringify({ timestamp: 'b', status: 'running', message: 'two' })}\n`,
    );
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    const entries = await store.readLedger('r');
    expect(entries.map((e) => e.message)).toEqual(['one', 'two']);
  });

  it('readLedger tolerates CRLF line endings', async () => {
    const { adapter, files } = makeFakeAdapter();
    files.set(
      '.claudian/runs/r/ledger.jsonl',
      `${JSON.stringify({ timestamp: 'a', status: 'running', message: 'one' })}\r\n` +
        `${JSON.stringify({ timestamp: 'b', status: 'running', message: 'two' })}\r\n`,
    );
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    expect((await store.readLedger('r')).map((e) => e.message)).toEqual(['one', 'two']);
  });
});

describe('RunSidecarStore.snapshotLedgerAsMarkdown', () => {
  it('renders ledger entries as one markdown line each, matching TaskNoteStore.appendLedger format', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await store.appendLedger('run-7', {
      timestamp: '2026-06-06T12:00:00.000Z',
      status: 'running',
      message: 'Run started (attempt 1)',
    });
    await store.appendLedger('run-7', {
      timestamp: '2026-06-06T12:00:05.000Z',
      status: 'review',
      message: 'Handoff written.',
    });

    const md = await store.snapshotLedgerAsMarkdown('run-7');
    expect(md).toBe(
      '- 2026-06-06T12:00:00.000Z [running] Run started (attempt 1)\n' +
      '- 2026-06-06T12:00:05.000Z [review] Handoff written.',
    );
  });

  it('returns empty string for a missing ledger', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    expect(await store.snapshotLedgerAsMarkdown('nope')).toBe('');
  });

  it('survives one bad line and keeps the rest', async () => {
    const { adapter, files } = makeFakeAdapter();
    files.set(
      '.claudian/runs/r/ledger.jsonl',
      `${JSON.stringify({ timestamp: 't1', status: 'running', message: 'one' })}\n` +
        '{ broken\n' +
        `${JSON.stringify({ timestamp: 't2', status: 'review', message: 'two' })}\n`,
    );
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    expect(await store.snapshotLedgerAsMarkdown('r')).toBe(
      '- t1 [running] one\n- t2 [review] two',
    );
  });

  it('flattens embedded newlines so one ledger entry stays one markdown line', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    await store.appendLedger('run-x', {
      timestamp: 't',
      status: 'running',
      message: 'line one\nline two\r\nline three',
    });
    const md = await store.snapshotLedgerAsMarkdown('run-x');
    // One markdown bullet, no embedded newlines.
    expect(md.split('\n')).toHaveLength(1);
    expect(md).toBe('- t [running] line one line two line three');
  });
});

describe('RunSidecarStore.ensureRunDir', () => {
  it('creates baseDir and parent .claudian when nothing exists', async () => {
    const { adapter, mkdirs } = makeFakeAdapter({ trackMkdir: true });
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await store.writeHeartbeat('run-x', { at: '2026-06-06T00:00:00Z', status: 'running' });

    expect(mkdirs).toContain('.claudian');
    expect(mkdirs).toContain('.claudian/runs');
    expect(mkdirs).toContain('.claudian/runs/run-x');
  });

  it('handles concurrent first-write to the same runId without throwing', async () => {
    const { adapter } = makeFakeAdapter({ rejectDuplicateMkdir: true });
    const store = new RunSidecarStore(adapter, '.claudian/runs');

    await expect(
      Promise.all([
        store.writeHeartbeat('run-y', { at: 't', status: 'running' }),
        store.appendLedger('run-y', { timestamp: 't', status: 'running', message: 'm' }),
      ]),
    ).resolves.not.toThrow();
  });
});

describe('RunSidecarStore.cleanupRun', () => {
  it('removes the run dir and its contents', async () => {
    const { adapter, files } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    await store.writeHeartbeat('r', { at: 't', status: 'running' });
    await store.appendLedger('r', { timestamp: 't', status: 'running', message: 'm' });
    expect(files.has('.claudian/runs/r/heartbeat.json')).toBe(true);

    await store.cleanupRun('r');

    expect(files.has('.claudian/runs/r/heartbeat.json')).toBe(false);
    expect(files.has('.claudian/runs/r/ledger.jsonl')).toBe(false);
  });

  it('is a no-op when the run dir does not exist', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    await expect(store.cleanupRun('nope')).resolves.toBeUndefined();
  });

  it('swallows a transient rmdir failure rather than poisoning the terminal path', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    await store.writeHeartbeat('r', { at: 't', status: 'running' });
    adapter.rmdir = jest.fn(async () => { throw new Error('boom'); }) as unknown as DataAdapter['rmdir'];

    await expect(store.cleanupRun('r')).resolves.toBeUndefined();
  });
});

describe('RunSidecarStore.listRuns', () => {
  it('returns [] when baseDir does not exist', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    expect(await store.listRuns()).toEqual([]);
  });

  it('returns the run-id subfolders under baseDir', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    // Seed two sidecars so the per-run directories exist on disk.
    await store.writeHeartbeat('run-a', { at: 't', status: 'running' });
    await store.writeHeartbeat('run-b', { at: 't', status: 'running' });

    const ids = (await store.listRuns()).sort();
    expect(ids).toEqual(['run-a', 'run-b']);
  });

  it('returns [] when the underlying list call throws', async () => {
    const { adapter } = makeFakeAdapter();
    const store = new RunSidecarStore(adapter, '.claudian/runs');
    await store.writeHeartbeat('run-a', { at: 't', status: 'running' });
    adapter.list = jest.fn(async () => { throw new Error('boom'); }) as unknown as DataAdapter['list'];

    expect(await store.listRuns()).toEqual([]);
  });
});
