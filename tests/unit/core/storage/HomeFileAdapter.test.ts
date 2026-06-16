import { mkdtempSync, rmSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HomeFileAdapter } from '@/core/storage/HomeFileAdapter';

describe('HomeFileAdapter', () => {
  let root: string;
  let adapter: HomeFileAdapter;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'home-file-adapter-'));
    adapter = new HomeFileAdapter(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('accepts a no-arg form that defaults to os.homedir()', () => {
      // Default form must not throw. Behavior against the real home directory
      // is not asserted here to avoid mutating the developer's filesystem.
      expect(() => new HomeFileAdapter()).not.toThrow();
    });

    it('resolves relative paths against the provided root', async () => {
      await adapter.write('marker.txt', 'hi');
      const onDisk = await fsp.readFile(path.join(root, 'marker.txt'), 'utf-8');
      expect(onDisk).toBe('hi');
    });
  });

  describe('exists', () => {
    it('returns true for an existing file', async () => {
      await fsp.writeFile(path.join(root, 'a.txt'), 'x');
      await expect(adapter.exists('a.txt')).resolves.toBe(true);
    });

    it('returns false for a missing path', async () => {
      await expect(adapter.exists('missing.txt')).resolves.toBe(false);
    });

    it('returns true for an existing directory', async () => {
      await fsp.mkdir(path.join(root, 'sub'));
      await expect(adapter.exists('sub')).resolves.toBe(true);
    });

    it('returns false for a nested path under a missing parent', async () => {
      await expect(adapter.exists('nope/deeper/file.md')).resolves.toBe(false);
    });
  });

  describe('read', () => {
    it('reads file content as utf-8', async () => {
      await fsp.writeFile(path.join(root, 'note.md'), 'hello world', 'utf-8');
      await expect(adapter.read('note.md')).resolves.toBe('hello world');
    });

    it('preserves unicode content', async () => {
      const text = 'café — 日本語 — 🦣';
      await fsp.writeFile(path.join(root, 'u.md'), text, 'utf-8');
      await expect(adapter.read('u.md')).resolves.toBe(text);
    });

    it('rejects with ENOENT for a missing file', async () => {
      await expect(adapter.read('missing.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  describe('write', () => {
    it('writes a file at the root', async () => {
      await adapter.write('a.txt', 'content');
      const onDisk = await fsp.readFile(path.join(root, 'a.txt'), 'utf-8');
      expect(onDisk).toBe('content');
    });

    it('creates missing parent directories before writing', async () => {
      await adapter.write('a/b/c/file.md', 'nested');
      const onDisk = await fsp.readFile(path.join(root, 'a', 'b', 'c', 'file.md'), 'utf-8');
      expect(onDisk).toBe('nested');
    });

    it('overwrites an existing file', async () => {
      await adapter.write('a.txt', 'first');
      await adapter.write('a.txt', 'second');
      await expect(adapter.read('a.txt')).resolves.toBe('second');
    });

    it('writes an empty string', async () => {
      await adapter.write('empty.txt', '');
      await expect(adapter.read('empty.txt')).resolves.toBe('');
    });
  });

  describe('delete', () => {
    it('removes an existing file', async () => {
      await fsp.writeFile(path.join(root, 'a.txt'), 'x');
      await adapter.delete('a.txt');
      await expect(adapter.exists('a.txt')).resolves.toBe(false);
    });

    it('silently ignores a missing file (ENOENT)', async () => {
      await expect(adapter.delete('missing.txt')).resolves.toBeUndefined();
    });

    it('rethrows non-ENOENT errors', async () => {
      // Calling unlink on a directory yields EISDIR on POSIX and EPERM on Win32.
      // Either way the adapter must propagate the error rather than swallowing it.
      await fsp.mkdir(path.join(root, 'is-dir'));
      await expect(adapter.delete('is-dir')).rejects.toThrow();
      // Directory must remain in place after the failed unlink.
      await expect(adapter.exists('is-dir')).resolves.toBe(true);
    });
  });

  describe('deleteFolder', () => {
    it('removes an empty folder', async () => {
      await fsp.mkdir(path.join(root, 'empty'));
      await adapter.deleteFolder('empty');
      await expect(adapter.exists('empty')).resolves.toBe(false);
    });

    it('silently ignores a missing folder', async () => {
      await expect(adapter.deleteFolder('does-not-exist')).resolves.toBeUndefined();
    });

    it('silently ignores a non-empty folder (rmdir fails)', async () => {
      await fsp.mkdir(path.join(root, 'full'));
      await fsp.writeFile(path.join(root, 'full', 'a.txt'), 'x');
      await expect(adapter.deleteFolder('full')).resolves.toBeUndefined();
      // Folder and its contents remain because rmdir refused to remove non-empty.
      await expect(adapter.exists('full')).resolves.toBe(true);
      await expect(adapter.exists('full/a.txt')).resolves.toBe(true);
    });
  });

  describe('listFolders', () => {
    it('returns subfolders prefixed with the requested folder', async () => {
      await fsp.mkdir(path.join(root, 'parent'));
      await fsp.mkdir(path.join(root, 'parent', 'a'));
      await fsp.mkdir(path.join(root, 'parent', 'b'));
      const result = await adapter.listFolders('parent');
      expect(result.sort()).toEqual(['parent/a', 'parent/b']);
    });

    it('excludes files', async () => {
      await fsp.mkdir(path.join(root, 'mixed'));
      await fsp.mkdir(path.join(root, 'mixed', 'sub'));
      await fsp.writeFile(path.join(root, 'mixed', 'file.txt'), 'x');
      await expect(adapter.listFolders('mixed')).resolves.toEqual(['mixed/sub']);
    });

    it('returns an empty array for a missing folder', async () => {
      await expect(adapter.listFolders('does/not/exist')).resolves.toEqual([]);
    });

    it('returns an empty array for an empty folder', async () => {
      await fsp.mkdir(path.join(root, 'empty'));
      await expect(adapter.listFolders('empty')).resolves.toEqual([]);
    });

    it('returns folder names joined with forward slash regardless of host separator', async () => {
      await fsp.mkdir(path.join(root, 'parent'));
      await fsp.mkdir(path.join(root, 'parent', 'child'));
      const [entry] = await adapter.listFolders('parent');
      // Adapter formats with `/` so callers can compose vault-style paths.
      expect(entry).toBe('parent/child');
    });
  });

  describe('ensureFolder', () => {
    it('creates a single folder', async () => {
      await adapter.ensureFolder('alpha');
      await expect(adapter.exists('alpha')).resolves.toBe(true);
    });

    it('creates nested folders in one call', async () => {
      await adapter.ensureFolder('a/b/c');
      await expect(adapter.exists('a/b/c')).resolves.toBe(true);
    });

    it('is idempotent when the folder already exists', async () => {
      await adapter.ensureFolder('alpha');
      await expect(adapter.ensureFolder('alpha')).resolves.toBeUndefined();
      await expect(adapter.exists('alpha')).resolves.toBe(true);
    });
  });

  // Cancellation: HomeFileAdapter exposes no AbortSignal — every method is a
  // single fs.promises call. Cancellation must happen upstream of the await,
  // so there is no in-adapter contract to assert here.

  describe('listFiles', () => {
    it('lists only files, prefixed with the folder path', async () => {
      await fsp.mkdir(path.join(root, '.cursor/agents/nested'), { recursive: true });
      await fsp.writeFile(path.join(root, '.cursor/agents/reviewer.md'), 'x');
      await fsp.writeFile(path.join(root, '.cursor/agents/helper.md'), 'y');

      const files = await adapter.listFiles('.cursor/agents');

      expect(files.sort()).toEqual(['.cursor/agents/helper.md', '.cursor/agents/reviewer.md']);
    });

    it('returns an empty array for a missing folder', async () => {
      await expect(adapter.listFiles('.cursor/agents')).resolves.toEqual([]);
    });
  });
});
