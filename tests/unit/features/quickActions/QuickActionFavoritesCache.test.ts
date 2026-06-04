import { QuickActionFavoritesCache } from '@/features/quickActions/QuickActionFavoritesCache';
import type { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => ({
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

function makeAction(rank: number | undefined, name: string, filePath: string): QuickAction {
  return {
    id: filePath,
    name,
    description: name,
    prompt: 'Body.',
    filePath,
    favorite: rank !== undefined ? true : undefined,
    favoriteRank: rank,
  };
}

function makeApp() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    handlers,
    vault: {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = handlers[event] ?? [];
        handlers[event].push(cb);
        return { event } as unknown;
      }),
      offref: jest.fn(),
    },
  };
}

function makeStorage(actions: QuickAction[]) {
  return {
    loadAll: jest.fn().mockResolvedValue(actions),
  } as unknown as QuickActionStorage;
}

async function flush() {
  await new Promise((r) => setImmediate(r));
}

describe('QuickActionFavoritesCache', () => {
  it('returns empty before initial load resolves', () => {
    const app = makeApp();
    const cache = new QuickActionFavoritesCache(makeStorage([]), app as any, () => 'Quick Actions');
    expect(cache.getFavorites()).toEqual([]);
    cache.dispose();
  });

  it('returns favorites sorted by rank after initial load', async () => {
    const app = makeApp();
    const storage = makeStorage([
      makeAction(3, 'C', 'Quick Actions/c.md'),
      makeAction(1, 'A', 'Quick Actions/a.md'),
      makeAction(undefined, 'Z', 'Quick Actions/z.md'),
    ]);
    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    await flush();

    const favs = cache.getFavorites();
    expect(favs.map((f) => f.favoriteRank)).toEqual([1, 3]);
    cache.dispose();
  });

  it('caps the returned list at five', async () => {
    const app = makeApp();
    const storage = makeStorage([1, 2, 3, 4, 5, 6].map((r) => makeAction(r > 5 ? undefined : r, `A${r}`, `Quick Actions/a${r}.md`)));
    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    await flush();
    expect(cache.getFavorites()).toHaveLength(5);
    cache.dispose();
  });

  it('reloads on vault modify event inside the favorites folder', async () => {
    const app = makeApp();
    const storage = makeStorage([makeAction(1, 'A', 'Quick Actions/a.md')]);
    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    await flush();
    expect(storage.loadAll).toHaveBeenCalledTimes(1);

    (storage.loadAll as jest.Mock).mockResolvedValue([
      makeAction(1, 'A', 'Quick Actions/a.md'),
      makeAction(2, 'B', 'Quick Actions/b.md'),
    ]);
    app.handlers.modify[0]({ path: 'Quick Actions/b.md' });
    await flush();

    expect(storage.loadAll).toHaveBeenCalledTimes(2);
    expect(cache.getFavorites()).toHaveLength(2);
    cache.dispose();
  });

  it('ignores events outside the favorites folder', async () => {
    const app = makeApp();
    const storage = makeStorage([]);
    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    await flush();
    const beforeCalls = (storage.loadAll as jest.Mock).mock.calls.length;

    app.handlers.modify[0]({ path: 'Notes/other.md' });
    await flush();

    expect((storage.loadAll as jest.Mock).mock.calls.length).toBe(beforeCalls);
    cache.dispose();
  });

  it('discards stale reload results when a newer reload supersedes', async () => {
    const app = makeApp();
    // First load returns old set; second load returns new set. We control
    // resolution order: resolve the second load BEFORE the first.
    let resolveFirst!: (v: QuickAction[]) => void;
    let resolveSecond!: (v: QuickAction[]) => void;
    const firstLoad = new Promise<QuickAction[]>((r) => { resolveFirst = r; });
    const secondLoad = new Promise<QuickAction[]>((r) => { resolveSecond = r; });

    const storage = {
      loadAll: jest.fn()
        .mockReturnValueOnce(firstLoad)
        .mockReturnValueOnce(secondLoad),
    } as unknown as QuickActionStorage;

    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start(); // triggers first reload
    cache.refresh(); // triggers second reload while first is still in flight

    // Resolve second (newer) first
    resolveSecond([makeAction(1, 'NEW', 'Quick Actions/new.md')]);
    await flush();
    expect(cache.getFavorites().map((f) => f.name)).toEqual(['NEW']);

    // Now resolve first (older) — should NOT overwrite the newer result
    resolveFirst([makeAction(2, 'OLD', 'Quick Actions/old.md')]);
    await flush();
    expect(cache.getFavorites().map((f) => f.name)).toEqual(['NEW']);

    cache.dispose();
  });

  it('discards in-flight reload results after dispose', async () => {
    const app = makeApp();
    let resolveLoad!: (v: QuickAction[]) => void;
    const pendingLoad = new Promise<QuickAction[]>((r) => { resolveLoad = r; });
    const storage = {
      loadAll: jest.fn().mockReturnValueOnce(pendingLoad),
    } as unknown as QuickActionStorage;

    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    cache.dispose();

    resolveLoad([makeAction(1, 'GONE', 'Quick Actions/gone.md')]);
    await flush();

    expect(cache.getFavorites()).toEqual([]);
  });
});
