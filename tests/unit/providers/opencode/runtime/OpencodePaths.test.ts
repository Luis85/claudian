import * as path from 'node:path';

jest.mock('node:fs', () => ({ existsSync: jest.fn(), readdirSync: jest.fn() }));
import * as fs from 'node:fs';

import {
  resolveExistingOpencodeDatabasePath,
  resolveOpencodeDatabasePath,
  resolveOpencodeDataDir,
} from '@/providers/opencode/runtime/OpencodePaths';

const existsSync = fs.existsSync as jest.Mock;
const readdirSync = fs.readdirSync as jest.Mock;

function withPlatform(value: NodeJS.Platform, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(process, 'platform', original);
  }
}

beforeEach(() => {
  existsSync.mockReset();
  readdirSync.mockReset();
  existsSync.mockReturnValue(false);
  readdirSync.mockReturnValue([]);
});

describe('resolveOpencodeDataDir', () => {
  it('prefers XDG_DATA_HOME when set', () => {
    expect(resolveOpencodeDataDir({ XDG_DATA_HOME: '/xdg' } as NodeJS.ProcessEnv))
      .toBe(path.join('/xdg', 'opencode'));
  });

  it('ignores a blank XDG_DATA_HOME and falls back to the linux default', () => {
    withPlatform('linux', () => {
      expect(resolveOpencodeDataDir({ XDG_DATA_HOME: '   ', HOME: '/home/u' } as NodeJS.ProcessEnv))
        .toBe(path.join('/home/u', '.local', 'share', 'opencode'));
    });
  });

  it('uses APPDATA on win32', () => {
    withPlatform('win32', () => {
      expect(resolveOpencodeDataDir({ HOME: 'C:\\u', APPDATA: '/app' } as NodeJS.ProcessEnv))
        .toBe(path.join('/app', 'opencode'));
    });
  });

  it('falls back to LOCALAPPDATA then the Roaming default on win32', () => {
    withPlatform('win32', () => {
      expect(resolveOpencodeDataDir({ HOME: '/h', LOCALAPPDATA: '/local' } as NodeJS.ProcessEnv))
        .toBe(path.join('/local', 'opencode'));
      expect(resolveOpencodeDataDir({ HOME: '/h' } as NodeJS.ProcessEnv))
        .toBe(path.join('/h', 'AppData', 'Roaming', 'opencode'));
    });
  });
});

describe('resolveOpencodeDatabasePath', () => {
  it('returns the OPENCODE_DB override verbatim for :memory: and absolute paths', () => {
    expect(resolveOpencodeDatabasePath({ OPENCODE_DB: ':memory:' } as NodeJS.ProcessEnv)).toBe(':memory:');
    expect(resolveOpencodeDatabasePath({ OPENCODE_DB: '/abs/x.db' } as NodeJS.ProcessEnv)).toBe('/abs/x.db');
  });

  it('resolves a relative OPENCODE_DB against the data dir', () => {
    expect(resolveOpencodeDatabasePath({ XDG_DATA_HOME: '/xdg', OPENCODE_DB: 'sub/x.db' } as NodeJS.ProcessEnv))
      .toBe(path.join('/xdg', 'opencode', 'sub/x.db'));
  });

  it('returns the first existing candidate', () => {
    const dataDir = path.join('/xdg', 'opencode');
    const expected = path.join(dataDir, 'opencode.db');
    existsSync.mockImplementation((p: string) => p === expected);
    expect(resolveOpencodeDatabasePath({ XDG_DATA_HOME: '/xdg', HOME: '/h' } as NodeJS.ProcessEnv)).toBe(expected);
  });

  it('falls back to the first candidate when none exist', () => {
    const expected = path.join('/xdg', 'opencode', 'opencode.db');
    expect(resolveOpencodeDatabasePath({ XDG_DATA_HOME: '/xdg', HOME: '/h' } as NodeJS.ProcessEnv)).toBe(expected);
  });

  it('orders the default db first, then alphabetised matches', () => {
    const dataDir = path.join('/xdg', 'opencode');
    readdirSync.mockImplementation((dir: string) =>
      dir === dataDir ? ['opencode-zeta.db', 'opencode.db', 'opencode-alpha.db', 'ignore.txt'] : []);
    existsSync.mockReturnValue(false);
    const result = resolveOpencodeDatabasePath({ XDG_DATA_HOME: '/xdg', HOME: '/h' } as NodeJS.ProcessEnv);
    // First candidate is always the default db (the sort pins it ahead of matches).
    expect(result).toBe(path.join(dataDir, 'opencode.db'));
  });
});

describe('resolveExistingOpencodeDatabasePath', () => {
  it('returns a preferred :memory: without touching the filesystem', () => {
    expect(resolveExistingOpencodeDatabasePath(':memory:', {} as NodeJS.ProcessEnv)).toBe(':memory:');
  });

  it('returns the preferred path when it exists on disk', () => {
    existsSync.mockImplementation((p: string) => p === '/pref/x.db');
    expect(resolveExistingOpencodeDatabasePath('/pref/x.db', { XDG_DATA_HOME: '/xdg' } as NodeJS.ProcessEnv))
      .toBe('/pref/x.db');
  });

  it('falls back to the resolved path when the preferred one is missing', () => {
    const resolved = path.join('/xdg', 'opencode', 'opencode.db');
    existsSync.mockImplementation((p: string) => p === resolved);
    expect(resolveExistingOpencodeDatabasePath('/missing.db', { XDG_DATA_HOME: '/xdg', HOME: '/h' } as NodeJS.ProcessEnv))
      .toBe(resolved);
  });

  it('returns preferred ?? resolved when neither exists', () => {
    existsSync.mockReturnValue(false);
    expect(resolveExistingOpencodeDatabasePath('/missing.db', { XDG_DATA_HOME: '/xdg', HOME: '/h' } as NodeJS.ProcessEnv))
      .toBe('/missing.db');
  });
});
