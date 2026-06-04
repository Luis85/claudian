import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { assignNextFavoriteRank,QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { QuickAction } from '@/features/quickActions/types';

function makeAction(partial: Partial<QuickAction>): QuickAction {
  return {
    id: partial.id ?? 'id',
    name: partial.name ?? 'Name',
    description: partial.description ?? 'Name',
    prompt: partial.prompt ?? 'Body.',
    filePath: partial.filePath ?? 'Quick Actions/name.md',
    favorite: partial.favorite,
    favoriteRank: partial.favoriteRank,
    icon: partial.icon,
    tags: partial.tags,
  };
}

function makeAdapter() {
  const files = new Map<string, string>();
  return {
    files,
    read: jest.fn(async (p: string) => files.get(p) ?? ''),
    write: jest.fn(async (p: string, c: string) => { files.set(p, c); }),
    delete: jest.fn(async (p: string) => { files.delete(p); }),
    ensureFolder: jest.fn(async () => undefined),
    listFilesRecursive: jest.fn(async () => Array.from(files.keys())),
  } satisfies Partial<VaultFileAdapter> & { files: Map<string, string> };
}

describe('assignNextFavoriteRank', () => {
  it('returns 1 when no favorites exist', () => {
    expect(assignNextFavoriteRank([])).toBe(1);
  });

  it('returns the lowest unused rank in 1..5', () => {
    const favs = [
      makeAction({ favorite: true, favoriteRank: 1 }),
      makeAction({ favorite: true, favoriteRank: 2 }),
      makeAction({ favorite: true, favoriteRank: 4 }),
    ];
    expect(assignNextFavoriteRank(favs)).toBe(3);
  });

  it('returns null when all five slots are taken', () => {
    const favs = [1, 2, 3, 4, 5].map((r) => makeAction({ favorite: true, favoriteRank: r }));
    expect(assignNextFavoriteRank(favs)).toBeNull();
  });

  it('ignores non-favorites when computing the next rank', () => {
    const list = [
      makeAction({ favorite: false, favoriteRank: 1 }),
      makeAction({ favorite: true, favoriteRank: 2 }),
    ];
    expect(assignNextFavoriteRank(list)).toBe(1);
  });

  it('returns null when five favorites exist with no ranks', () => {
    const favs = [1, 2, 3, 4, 5].map((i) =>
      makeAction({ favorite: true, favoriteRank: undefined, name: `F${i}` }),
    );
    expect(assignNextFavoriteRank(favs)).toBeNull();
  });

  it('returns null when total favorites (ranked + unranked) reaches five', () => {
    const favs = [
      makeAction({ favorite: true, favoriteRank: 1 }),
      makeAction({ favorite: true, favoriteRank: 2 }),
      makeAction({ favorite: true, favoriteRank: undefined, name: 'U1' }),
      makeAction({ favorite: true, favoriteRank: undefined, name: 'U2' }),
      makeAction({ favorite: true, favoriteRank: undefined, name: 'U3' }),
    ];
    expect(assignNextFavoriteRank(favs)).toBeNull();
  });

  it('returns the lowest unused rank when total < 5 even with unranked favorites', () => {
    const favs = [
      makeAction({ favorite: true, favoriteRank: 1 }),
      makeAction({ favorite: true, favoriteRank: undefined, name: 'U1' }),
    ];
    // 2 favorites total, ranks {1, -}, lowest unused rank is 2
    expect(assignNextFavoriteRank(favs)).toBe(2);
  });
});

describe('QuickActionStorage favorites', () => {
  it('setFavorite writes favorite: true and favoriteRank, preserves body', async () => {
    const adapter = makeAdapter();
    adapter.files.set('Quick Actions/foo.md', `---
type: quick-action
name: Foo
---

Original body.
`);
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({ name: 'Foo', filePath: 'Quick Actions/foo.md', prompt: 'Original body.' });

    await storage.setFavorite(action, 2);

    const written = adapter.files.get('Quick Actions/foo.md')!;
    expect(written).toContain('favorite: true');
    expect(written).toContain('favoriteRank: 2');
    expect(written).toContain('Original body.');
  });

  it('unsetFavorite strips both fields and preserves body', async () => {
    const adapter = makeAdapter();
    adapter.files.set('Quick Actions/foo.md', `---
type: quick-action
name: Foo
favorite: true
favoriteRank: 3
---

Original body.
`);
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({
      name: 'Foo',
      filePath: 'Quick Actions/foo.md',
      prompt: 'Original body.',
      favorite: true,
      favoriteRank: 3,
    });

    await storage.unsetFavorite(action);

    const written = adapter.files.get('Quick Actions/foo.md')!;
    expect(written).not.toContain('favorite:');
    expect(written).not.toContain('favoriteRank:');
    expect(written).toContain('Original body.');
  });

  it('save forwards favorite and favoriteRank to the on-disk YAML', async () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({
      name: 'Saved',
      filePath: 'Quick Actions/saved.md',
      prompt: 'Body.',
      favorite: true,
      favoriteRank: 4,
    });

    await storage.save(action);

    const written = adapter.files.get('Quick Actions/saved.md')!;
    expect(written).toContain('favorite: true');
    expect(written).toContain('favoriteRank: 4');
  });
});
