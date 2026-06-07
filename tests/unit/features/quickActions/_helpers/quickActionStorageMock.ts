import type { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';

export interface StorageMockOpts {
  exists?: boolean;
  save?: jest.Mock;
}

/**
 * Minimal `jest.Mocked<QuickActionStorage>` for tests that need a stub of
 * the storage surface without driving a real `VaultFileAdapter`. Each test
 * gets a fresh set of jest.fn()s so spy assertions stay isolated.
 */
export function createStorageMock(opts: StorageMockOpts = {}): jest.Mocked<QuickActionStorage> {
  return {
    exists: jest.fn(async () => opts.exists ?? false),
    hasConfiguredFolder: jest.fn(() => true),
    getFilePathForName: jest.fn((name: string) => `Quick Actions/${name.toLowerCase()}.md`),
    save: opts.save ?? jest.fn(async () => 'Quick Actions/saved.md'),
    delete: jest.fn(),
    loadAll: jest.fn(),
    loadFromFile: jest.fn(),
    setFavorite: jest.fn(),
    unsetFavorite: jest.fn(),
  } as unknown as jest.Mocked<QuickActionStorage>;
}
