import { itPosix, itWin32 } from '@test/helpers/platform';

import { classifyOsPath } from '@/features/chat/controllers/osPathClassification';

describe('classifyOsPath', () => {
  itPosix('classifies a file under the vault as vault-file', () => {
    const result = classifyOsPath(
      '/Users/me/vault/notes/a.md',
      '/Users/me/vault',
      [],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'vault-file', relPath: 'notes/a.md' });
  });

  itPosix('classifies a folder under the vault as vault-folder', () => {
    const result = classifyOsPath(
      '/Users/me/vault/notes/sub',
      '/Users/me/vault',
      [],
      { isDirectory: true }
    );
    expect(result).toEqual({ kind: 'vault-folder', relPath: 'notes/sub' });
  });

  itPosix('classifies a file under an external root as external-file', () => {
    const result = classifyOsPath(
      '/Users/me/projects/foo/src/index.ts',
      '/Users/me/vault',
      ['/Users/me/projects/foo'],
      { isDirectory: false }
    );
    expect(result).toEqual({
      kind: 'external-file',
      contextRoot: '/Users/me/projects/foo',
    });
  });

  itPosix('classifies a folder under an external root as external-folder', () => {
    const result = classifyOsPath(
      '/Users/me/projects/foo/src',
      '/Users/me/vault',
      ['/Users/me/projects/foo'],
      { isDirectory: true }
    );
    expect(result).toEqual({
      kind: 'external-folder',
      contextRoot: '/Users/me/projects/foo',
    });
  });

  itPosix('rejects a path outside vault and external roots', () => {
    const result = classifyOsPath(
      '/tmp/elsewhere/x.md',
      '/Users/me/vault',
      ['/Users/me/projects/foo'],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'rejected' });
  });

  itWin32('classifies a Windows vault file with mixed slashes', () => {
    const result = classifyOsPath(
      'D:\\Projects\\vault\\notes\\a.md',
      'D:\\Projects\\vault',
      [],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'vault-file', relPath: 'notes/a.md' });
  });

  itWin32('classifies a Windows external file', () => {
    const result = classifyOsPath(
      'C:\\Work\\foo\\src\\index.ts',
      'D:\\Projects\\vault',
      ['C:\\Work\\foo'],
      { isDirectory: false }
    );
    expect(result).toEqual({
      kind: 'external-file',
      contextRoot: 'C:\\Work\\foo',
    });
  });

  itWin32('rejects a Windows path outside vault and external roots', () => {
    const result = classifyOsPath(
      'E:\\elsewhere\\x.md',
      'D:\\Projects\\vault',
      ['C:\\Work\\foo'],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'rejected' });
  });

  itPosix('prefers vault over external root when both match', () => {
    const result = classifyOsPath(
      '/Users/me/vault/notes/a.md',
      '/Users/me/vault',
      ['/Users/me'],
      { isDirectory: false }
    );
    expect(result).toEqual({ kind: 'vault-file', relPath: 'notes/a.md' });
  });
});
