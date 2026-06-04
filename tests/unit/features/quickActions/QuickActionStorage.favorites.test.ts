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

  it('loadAll does not create the folder when it does not exist', async () => {
    const adapter = makeAdapter();
    // Folder does not exist; only the ensureFolder spy would prove creation.
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');

    const result = await storage.loadAll();

    expect(result).toEqual([]);
    expect((adapter.ensureFolder as jest.Mock)).not.toHaveBeenCalled();
  });

  it('save still ensures the folder exists before writing', async () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    await storage.save({
      id: 'x',
      name: 'X',
      description: 'X',
      prompt: 'Body.',
      filePath: 'Quick Actions/x.md',
    });
    expect((adapter.ensureFolder as jest.Mock)).toHaveBeenCalledWith('Quick Actions');
  });

  it('setFavorite preserves unrelated frontmatter keys', async () => {
    const adapter = makeAdapter();
    adapter.files.set('Quick Actions/with-extra.md', `---
type: quick-action
name: Extra
aliases:
  - Alias One
cssclasses: my-class
custom_field: kept
---

Body kept.
`);
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({
      name: 'Extra',
      filePath: 'Quick Actions/with-extra.md',
      prompt: 'Body kept.',
    });

    await storage.setFavorite(action, 2);

    const written = adapter.files.get('Quick Actions/with-extra.md')!;
    expect(written).toContain('favorite: true');
    expect(written).toContain('favoriteRank: 2');
    expect(written).toContain('aliases:');
    expect(written).toContain('  - Alias One');
    expect(written).toContain('cssclasses: my-class');
    expect(written).toContain('custom_field: kept');
    expect(written).toContain('Body kept.');
  });

  it('unsetFavorite preserves unrelated frontmatter keys and strips only favorite lines', async () => {
    const adapter = makeAdapter();
    adapter.files.set('Quick Actions/with-extra.md', `---
type: quick-action
name: Extra
aliases:
  - Alias One
favorite: true
favoriteRank: 3
custom_field: kept
---

Body.
`);
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({
      name: 'Extra',
      filePath: 'Quick Actions/with-extra.md',
      prompt: 'Body.',
      favorite: true,
      favoriteRank: 3,
    });

    await storage.unsetFavorite(action);

    const written = adapter.files.get('Quick Actions/with-extra.md')!;
    expect(written).not.toMatch(/^favorite:/m);
    expect(written).not.toMatch(/^favoriteRank:/m);
    expect(written).toContain('aliases:');
    expect(written).toContain('  - Alias One');
    expect(written).toContain('custom_field: kept');
    expect(written).toContain('Body.');
  });

  it('setFavorite appends favorite lines when none exist', async () => {
    const adapter = makeAdapter();
    adapter.files.set('Quick Actions/plain.md', `---
type: quick-action
name: Plain
---

Body.
`);
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({ name: 'Plain', filePath: 'Quick Actions/plain.md', prompt: 'Body.' });

    await storage.setFavorite(action, 1);

    const written = adapter.files.get('Quick Actions/plain.md')!;
    expect(written).toContain('favorite: true');
    expect(written).toContain('favoriteRank: 1');
    expect(written).toContain('type: quick-action');
    expect(written).toContain('name: Plain');
  });

  it('setFavorite replaces existing favorite lines without duplication', async () => {
    const adapter = makeAdapter();
    adapter.files.set('Quick Actions/foo.md', `---
type: quick-action
name: Foo
favorite: true
favoriteRank: 2
---

Body.
`);
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({
      name: 'Foo',
      filePath: 'Quick Actions/foo.md',
      prompt: 'Body.',
      favorite: true,
      favoriteRank: 2,
    });

    await storage.setFavorite(action, 4);

    const written = adapter.files.get('Quick Actions/foo.md')!;
    const favoriteMatches = (written.match(/^favorite:/gm) ?? []).length;
    const rankMatches = (written.match(/^favoriteRank:/gm) ?? []).length;
    expect(favoriteMatches).toBe(1);
    expect(rankMatches).toBe(1);
    expect(written).toContain('favoriteRank: 4');
  });
});
