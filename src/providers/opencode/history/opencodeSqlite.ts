import { spawnSync } from 'node:child_process';

import { isPlainObject, type StoredRow } from './opencodeStoredRow';

export interface SqliteModule {
  DatabaseSync: new (location: string, options?: Record<string, unknown>) => {
    close(): void;
    prepare(sql: string): {
      all(...params: unknown[]): StoredRow[];
    };
  };
}

// Large OpenCode sessions overflow the default 1MB child stdout buffer, which
// surfaced as ENOBUFS on Windows; lift the cap on every spawned query (#776).
const OPENCODE_SQLITE_QUERY_MAX_BUFFER = 100 * 1024 * 1024;

/**
 * Acquire node:sqlite through the CommonJS require bound to this module rather
 * than a dynamic import. Obsidian's Electron renderer cannot reliably
 * dynamic-import Node builtins, so module.require keeps in-process SQLite
 * working there (#776).
 */
function requireSqliteModule(): SqliteModule | null {
  try {
    if (typeof module === 'undefined' || typeof module.require !== 'function') {
      return null;
    }
    const sqlite = module.require('node:sqlite') as unknown;
    return isSqliteModule(sqlite) ? sqlite : null;
  } catch {
    return null;
  }
}

function isSqliteModule(value: unknown): value is SqliteModule {
  return isPlainObject(value) && typeof value.DatabaseSync === 'function';
}

export async function loadSqliteModule(): Promise<SqliteModule | null> {
  return requireSqliteModule();
}

export async function isSqliteTransportAvailable(): Promise<boolean> {
  const sqliteModule = await loadSqliteModule();
  if (sqliteModule) return true;
  return isSqlite3CliAvailable();
}

function isSqlite3CliAvailable(): boolean {
  const probe = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

export function runSqlite3JsonQuery(
  databasePath: string,
  sql: string,
): StoredRow[] | null {
  const result = spawnSync(
    'sqlite3',
    ['-json', databasePath, sql],
    {
      encoding: 'utf8',
      maxBuffer: OPENCODE_SQLITE_QUERY_MAX_BUFFER,
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout || '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((row): row is StoredRow => isPlainObject(row))
      : null;
  } catch {
    return null;
  }
}

export function escapeSqlLiteral(value: string): string {
  return value.replaceAll('\'', '\'\'');
}
