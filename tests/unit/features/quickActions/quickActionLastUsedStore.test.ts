import type { Logger } from '@/core/logging/Logger';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import {
  parsePersistedLastUsed,
  PERSISTED_SCHEMA_VERSION,
  serializePersistedLastUsed,
} from '@/features/quickActions/quickActionLastUsedStore';
import { QuickActionLastUsedStore } from '@/features/quickActions/quickActionLastUsedStore';

class StubAdapter {
  files: Record<string, string> = {};
  writeCount = 0;
  async exists(p: string): Promise<boolean> { return p in this.files; }
  async read(p: string): Promise<string> { return this.files[p]; }
  async write(p: string, content: string): Promise<void> {
    this.writeCount += 1;
    this.files[p] = content;
  }
}

function makeStore(adapter: StubAdapter, logger?: { warn: jest.Mock }) {
  return new QuickActionLastUsedStore({
    adapter: adapter as unknown as VaultFileAdapter,
    cachePath: '.claudian/cache/quick-action-last-used.json',
    debounceMs: 10,
    logger: (logger ?? { warn: jest.fn() }) as unknown as Logger,
    now: () => 5000,
  });
}

describe('QuickActionLastUsedStore', () => {
  it('hydrates to empty when file does not exist', async () => {
    const adapter = new StubAdapter();
    const store = makeStore(adapter);
    await store.hydrate();
    expect(store.get('summarize')).toBeNull();
  });

  it('hydrates from a valid file', async () => {
    const adapter = new StubAdapter();
    adapter.files['.claudian/cache/quick-action-last-used.json'] = JSON.stringify({
      schemaVersion: 1,
      writtenAt: 0,
      entries: { summarize: { providerId: 'claude', model: 'm', updatedAt: 1 } },
    });
    const store = makeStore(adapter);
    await store.hydrate();
    expect(store.get('summarize')).toEqual({ providerId: 'claude', model: 'm', updatedAt: 1 });
  });

  it('warn-logs and treats malformed JSON as cold cache', async () => {
    const adapter = new StubAdapter();
    adapter.files['.claudian/cache/quick-action-last-used.json'] = 'not-json';
    const logger = { warn: jest.fn() };
    const store = makeStore(adapter, logger);
    await store.hydrate();
    expect(store.get('summarize')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('set updates in-memory immediately', () => {
    const store = makeStore(new StubAdapter());
    store.set('summarize', { providerId: 'claude', model: 'm' });
    expect(store.get('summarize')).toEqual({ providerId: 'claude', model: 'm', updatedAt: 5000 });
  });

  it('coalesces multiple set calls into one debounced write', async () => {
    const adapter = new StubAdapter();
    const store = makeStore(adapter);
    store.set('a', { providerId: 'claude', model: 'm1' });
    store.set('b', { providerId: 'claude', model: 'm2' });
    store.set('c', { providerId: 'claude', model: 'm3' });
    await store.flush();
    expect(adapter.writeCount).toBe(1);
    const parsed = JSON.parse(adapter.files['.claudian/cache/quick-action-last-used.json']);
    expect(Object.keys(parsed.entries).sort()).toEqual(['a', 'b', 'c']);
  });

  it('flush awaits pending write', async () => {
    const adapter = new StubAdapter();
    const store = makeStore(adapter);
    store.set('x', { providerId: 'claude', model: 'm' });
    await store.flush();
    expect(adapter.writeCount).toBe(1);
  });

  it('swallows write errors and warn-logs', async () => {
    const adapter = new StubAdapter();
    adapter.write = jest.fn().mockRejectedValue(new Error('disk full'));
    const logger = { warn: jest.fn() };
    const store = makeStore(adapter, logger);
    store.set('x', { providerId: 'claude', model: 'm' });
    await store.flush();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('quickActionLastUsedStore persistence', () => {
  describe('serializePersistedLastUsed', () => {
    it('writes schemaVersion + entries map', () => {
      const map = new Map([
        ['summarize', { providerId: 'claude' as const, model: 'claude-sonnet-4-5', updatedAt: 1700000000000 }],
      ]);
      const json = serializePersistedLastUsed(map, 1700000000123);
      const parsed = JSON.parse(json);
      expect(parsed.schemaVersion).toBe(PERSISTED_SCHEMA_VERSION);
      expect(parsed.writtenAt).toBe(1700000000123);
      expect(parsed.entries.summarize).toEqual({
        providerId: 'claude',
        model: 'claude-sonnet-4-5',
        updatedAt: 1700000000000,
      });
    });
  });

  describe('parsePersistedLastUsed', () => {
    it('returns Map for valid input', () => {
      const raw = JSON.stringify({
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        writtenAt: 0,
        entries: {
          summarize: { providerId: 'claude', model: 'claude-sonnet-4-5', updatedAt: 1 },
        },
      });
      const out = parsePersistedLastUsed(raw);
      expect(out?.get('summarize')).toEqual({
        providerId: 'claude',
        model: 'claude-sonnet-4-5',
        updatedAt: 1,
      });
    });

    it('returns null on malformed JSON', () => {
      expect(parsePersistedLastUsed('not-json')).toBeNull();
    });

    it('returns null on schema-version mismatch', () => {
      const raw = JSON.stringify({ schemaVersion: 999, writtenAt: 0, entries: {} });
      expect(parsePersistedLastUsed(raw)).toBeNull();
    });

    it('returns null when entries missing', () => {
      const raw = JSON.stringify({ schemaVersion: PERSISTED_SCHEMA_VERSION, writtenAt: 0 });
      expect(parsePersistedLastUsed(raw)).toBeNull();
    });

    it('skips non-object entry values without throwing', () => {
      const raw = JSON.stringify({
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        writtenAt: 0,
        entries: {
          bad: 'not-an-object',
          good: { providerId: 'claude', model: 'm', updatedAt: 1 },
        },
      });
      const out = parsePersistedLastUsed(raw);
      expect(out?.has('bad')).toBe(false);
      expect(out?.get('good')?.model).toBe('m');
    });
  });
});
