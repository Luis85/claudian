import type { Logger } from '@/core/logging/Logger';
import { USAGE_INDEX_SCHEMA_VERSION, type UsageIndex } from '@/core/usage/types';
import { UsageStorage } from '@/core/usage/UsageStorage';

interface FakeAdapter {
  files: Map<string, string>;
  exists: jest.Mock;
  read: jest.Mock;
  write: jest.Mock;
  ensureFolder: jest.Mock;
}

function makeAdapter(initial: Record<string, string> = {}): FakeAdapter {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    exists: jest.fn(async (p: string) => files.has(p)),
    read: jest.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`missing ${p}`);
      return v;
    }),
    write: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    ensureFolder: jest.fn(async () => undefined),
  };
}

function silentLogger(): Logger {
  const noop = () => undefined;
  return {
    scope: () => ({ debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false }),
  } as unknown as Logger;
}

describe('UsageStorage', () => {
  const PATH = '.specorator/usage.json';
  const CORRUPT = '.specorator/usage.corrupt.json';

  it('returns empty index when file missing', async () => {
    const adapter = makeAdapter();
    const storage = new UsageStorage(adapter as never, silentLogger());
    const idx = await storage.load();
    expect(idx).toEqual({ version: USAGE_INDEX_SCHEMA_VERSION, records: {} });
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it('round-trips a non-empty index', async () => {
    const adapter = makeAdapter();
    const storage = new UsageStorage(adapter as never, silentLogger());
    const idx: UsageIndex = {
      version: USAGE_INDEX_SCHEMA_VERSION,
      records: { 'quickAction:_:summarize': { count: 3, lastUsedAt: 1000 } },
    };
    await storage.save(idx);
    expect(adapter.files.get(PATH)).toContain('summarize');
    const reloaded = await storage.load();
    expect(reloaded).toEqual(idx);
  });

  it('backs up + cold-starts on malformed JSON', async () => {
    const adapter = makeAdapter({ [PATH]: 'not json' });
    const storage = new UsageStorage(adapter as never, silentLogger());
    const idx = await storage.load();
    expect(idx.records).toEqual({});
    expect(adapter.files.get(CORRUPT)).toBe('not json');
  });

  it('cold-starts on schema version mismatch', async () => {
    const adapter = makeAdapter({
      [PATH]: JSON.stringify({ version: 999, records: {} }),
    });
    const storage = new UsageStorage(adapter as never, silentLogger());
    const idx = await storage.load();
    expect(idx.records).toEqual({});
  });

  it('does not throw on write failure', async () => {
    const adapter = makeAdapter();
    adapter.write.mockRejectedValueOnce(new Error('disk full'));
    const storage = new UsageStorage(adapter as never, silentLogger());
    await expect(storage.save({
      version: USAGE_INDEX_SCHEMA_VERSION, records: {},
    })).resolves.toBeUndefined();
  });
});
