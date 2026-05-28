import type { App } from 'obsidian';
import type * as pathType from 'path';

import {
  cleanToolPathCandidate,
  resolveOpenableVaultPath,
} from '@/utils/fileLink';
import { getVaultFileByPath } from '@/utils/obsidianCompat';

jest.mock('@/utils/obsidianCompat', () => ({
  getVaultFileByPath: jest.fn(),
}));

jest.mock('@/utils/path', () => {
  const path = jest.requireActual<typeof pathType>('path');
  const vaultPath = path.resolve('/vault');

  function resolveInsideVault(candidate: string): string {
    const normalized = candidate.replace(/\\/g, '/');
    return path.isAbsolute(normalized)
      ? path.normalize(normalized)
      : path.resolve(vaultPath, normalized);
  }

  function isInsideVault(candidate: string): boolean {
    const absCandidate = resolveInsideVault(candidate);
    const rel = path.relative(vaultPath, absCandidate);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  return {
    getVaultPath: () => vaultPath,
    normalizePathForFilesystem: (raw: string) => raw.replace(/\\/g, '/'),
    isPathWithinVault: (candidate: string, root: string) =>
      root === vaultPath && isInsideVault(candidate),
    normalizePathForVault: (raw: string, root: string | null) => {
      if (!root) return null;
      if (!isInsideVault(raw)) {
        return raw.replace(/\\/g, '/');
      }
      const abs = resolveInsideVault(raw);
      return path.relative(vaultPath, abs).replace(/\\/g, '/');
    },
  };
});

describe('cleanToolPathCandidate', () => {
  it('strips Cursor glob prefixes', () => {
    expect(cleanToolPathCandidate('../.\\README.md')).toBe('README.md');
    expect(cleanToolPathCandidate('../src/core/CLAUDE.md')).toBe('src/core/CLAUDE.md');
  });
});

describe('resolveOpenableVaultPath', () => {
  const app = {} as App;

  beforeEach(() => {
    jest.mocked(getVaultFileByPath).mockReset();
  });

  it('resolves cleaned Cursor paths when the file exists in the vault', () => {
    jest.mocked(getVaultFileByPath).mockImplementation((_, path) =>
      path === 'README.md' ? ({ path: 'README.md' } as never) : null,
    );

    expect(resolveOpenableVaultPath(app, '../.\\README.md')).toBe('README.md');
  });

  it('returns null when no vault file matches', () => {
    jest.mocked(getVaultFileByPath).mockReturnValue(null);
    expect(resolveOpenableVaultPath(app, 'missing.md')).toBeNull();
  });

  it('returns null for absolute paths outside the vault', () => {
    const pathMod = jest.requireActual<typeof pathType>('path');
    jest.mocked(getVaultFileByPath).mockReturnValue({ path: 'outside.md' } as never);
    const outside = pathMod.resolve('/outside-vault/note.md');
    expect(resolveOpenableVaultPath(app, outside)).toBeNull();
  });
});
