import { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function makeAdapter(existing = new Set<string>()): VaultFileAdapter {
  return {
    exists: jest.fn(async (p: string) => existing.has(p)),
    read: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
    ensureFolder: jest.fn(),
    listFilesRecursive: jest.fn(),
    append: jest.fn(),
  } as unknown as VaultFileAdapter;
}

describe('QuickActionStorage.exists', () => {
  it('returns true when the adapter reports the file exists', async () => {
    const adapter = makeAdapter(new Set(['Quick Actions/foo.md']));
    const storage = new QuickActionStorage(adapter, () => 'Quick Actions');

    await expect(storage.exists('Quick Actions/foo.md')).resolves.toBe(true);
    expect(adapter.exists).toHaveBeenCalledWith('Quick Actions/foo.md');
  });

  it('returns false when the adapter reports the file is absent', async () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter, () => 'Quick Actions');

    await expect(storage.exists('Quick Actions/missing.md')).resolves.toBe(false);
  });
});
