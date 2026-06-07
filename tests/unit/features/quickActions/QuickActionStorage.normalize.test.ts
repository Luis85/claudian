import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { QuickAction } from '@/features/quickActions/types';

function makeAdapter(): jest.Mocked<VaultFileAdapter> {
  return {
    exists: jest.fn(async () => false),
    read: jest.fn(),
    write: jest.fn(async () => undefined),
    delete: jest.fn(),
    ensureFolder: jest.fn(async () => undefined),
    listFilesRecursive: jest.fn(async () => []),
    append: jest.fn(),
  } as unknown as jest.Mocked<VaultFileAdapter>;
}

describe('QuickActionStorage folder normalization', () => {
  // A folder configured with duplicate / backslash separators must resolve to
  // the same normalized path for both saving and loading; otherwise a saved
  // action is written under `Quick/Actions/...` but scanned under the raw
  // `Quick//Actions`, so it disappears on reload.
  it('scans the normalized folder in loadAll', async () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter, () => 'Quick//Actions');

    await storage.loadAll();

    expect(adapter.listFilesRecursive).toHaveBeenCalledWith('Quick/Actions');
  });

  it('ensures + writes under the same normalized folder on save', async () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter, () => 'Quick//Actions');

    const action = { name: 'My Action', prompt: 'do it' } as QuickAction;
    const written = await storage.save(action);

    expect(adapter.ensureFolder).toHaveBeenCalledWith('Quick/Actions');
    expect(written).toBe('Quick/Actions/my-action.md');
    expect(adapter.write).toHaveBeenCalledWith('Quick/Actions/my-action.md', expect.any(String));
  });

  it('derives the file path under the normalized folder', () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter, () => 'Quick//Actions');

    expect(storage.getFilePathForName('My Action')).toBe('Quick/Actions/my-action.md');
  });

  it('returns [] without scanning when the folder is unset', async () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter, () => '   ');

    await expect(storage.loadAll()).resolves.toEqual([]);
    expect(adapter.listFilesRecursive).not.toHaveBeenCalled();
  });

  it('reports whether a folder is configured', () => {
    const adapter = makeAdapter();
    expect(new QuickActionStorage(adapter, () => 'Quick Actions').hasConfiguredFolder()).toBe(true);
    expect(new QuickActionStorage(adapter, () => '   ').hasConfiguredFolder()).toBe(false);
  });

  it('refuses to save when the folder is blank (would vanish on reload)', async () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter, () => '');

    await expect(storage.save({ name: 'X', prompt: 'p' } as QuickAction)).rejects.toThrow();
    expect(adapter.write).not.toHaveBeenCalled();
  });
});
