import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Make in-process node:sqlite unavailable so hydration falls through to the
// sqlite3 CLI path, where the ENOBUFS guard (#776) lives.
jest.mock('node:sqlite', () => ({}));

const mockSpawnSync = jest.fn();
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import { loadOpencodeSessionMessages } from '../../../../src/providers/opencode/history/OpencodeHistoryStore';

describe('OpencodeHistoryStore sqlite3 CLI fallback (#776)', () => {
  let tmpRoot: string;
  let dbPath: string;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'claudian-opencode-hydration-'));
    dbPath = path.join(tmpRoot, 'opencode.db');
    writeFileSync(dbPath, '');
  });

  afterEach(() => {
    rmSync(tmpRoot, { force: true, recursive: true });
  });

  it('lifts the child stdout buffer cap on sqlite3 queries to avoid ENOBUFS on large sessions', async () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '[]', error: undefined });

    const result = await loadOpencodeSessionMessages('session-1', { databasePath: dbPath });

    expect(result.messages).toEqual([]);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'sqlite3',
      expect.arrayContaining(['-json', dbPath]),
      expect.objectContaining({ maxBuffer: 100 * 1024 * 1024, windowsHide: true }),
    );
  });
});
