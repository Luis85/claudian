import type { DataAdapter } from 'obsidian';

import type { TaskLedgerEntry, TaskStatus } from '../model/taskTypes';

export interface RunSidecarHeartbeat {
  at: string;
  status: TaskStatus;
  pauseReason?: string | null;
  /**
   * Identifies the plugin instance that wrote this heartbeat. Mismatch with the
   * current plugin's runtimeId means the previous load died — orphan recovery
   * treats the card as dead immediately, without waiting for the 5-minute
   * stale-`at` window. Absent on legacy sidecars (pre-upgrade): callers must
   * fall back to the `at` freshness check.
   */
  runtimeId?: string;
}

export class RunSidecarStore {
  // Memoize the parent-dir walk so two concurrent first-writes don't both try to
  // mkdir `.claudian` (Obsidian's adapter.mkdir is non-recursive and may throw
  // EEXIST on the second call).
  private baseDirReady: Promise<void> | null = null;
  // Per-run dir creation, memoized so two concurrent first-writes for the same
  // runId race through a single mkdir.
  private readonly runDirReady = new Map<string, Promise<void>>();

  constructor(
    private readonly adapter: DataAdapter,
    private readonly baseDir: string,
  ) {}

  private runDir(runId: string): string { return `${this.baseDir}/${runId}`; }
  private heartbeatPath(runId: string): string { return `${this.runDir(runId)}/heartbeat.json`; }
  private ledgerPath(runId: string): string { return `${this.runDir(runId)}/ledger.jsonl`; }

  async writeHeartbeat(runId: string, heartbeat: RunSidecarHeartbeat): Promise<void> {
    await this.ensureRunDir(runId);
    await this.adapter.write(this.heartbeatPath(runId), JSON.stringify(heartbeat, null, 2));
  }

  async readHeartbeat(runId: string): Promise<RunSidecarHeartbeat | null> {
    if (!(await this.adapter.exists(this.heartbeatPath(runId)))) return null;
    const raw = await this.adapter.read(this.heartbeatPath(runId));
    return JSON.parse(raw) as RunSidecarHeartbeat;
  }

  async appendLedger(runId: string, entry: TaskLedgerEntry): Promise<void> {
    await this.ensureRunDir(runId);
    const line = `${JSON.stringify(entry)}\n`;
    await this.adapter.append(this.ledgerPath(runId), line);
  }

  async readLedger(runId: string): Promise<TaskLedgerEntry[]> {
    if (!(await this.adapter.exists(this.ledgerPath(runId)))) return [];
    const raw = await this.adapter.read(this.ledgerPath(runId));
    const entries: TaskLedgerEntry[] = [];
    // Tolerate CRLF (Windows-edited files) and skip any malformed JSON line so
    // one corrupt entry doesn't strand the whole snapshot.
    for (const line of raw.split(/\r?\n/)) {
      if (line.length === 0) continue;
      try {
        entries.push(JSON.parse(line) as TaskLedgerEntry);
      } catch {
        // Corrupt line — drop it; the rest of the ledger is still recoverable.
      }
    }
    return entries;
  }

  async snapshotLedgerAsMarkdown(runId: string): Promise<string> {
    const entries = await this.readLedger(runId);
    return entries
      // Flatten embedded newlines so one ledger entry stays one markdown line —
      // a multiline message would otherwise break the snapshot region's
      // line-per-entry contract.
      .map((e) => `- ${e.timestamp} [${e.status}] ${e.message.replace(/\r?\n/g, ' ')}`)
      .join('\n');
  }

  /**
   * Lists every `<runId>` directory present under `baseDir`. Used by the
   * startup sweep to find sidecars whose owning work order is gone or
   * terminal. Returns [] when `baseDir` doesn't exist yet, or when listing
   * fails — best-effort: a sweep that can't read the directory just skips
   * cleanup for this session.
   */
  async listRuns(): Promise<string[]> {
    if (!(await this.adapter.exists(this.baseDir))) return [];
    try {
      const listing = await this.adapter.list(this.baseDir);
      return listing.folders.map((path) => {
        // Obsidian's DataAdapter normalizes to forward slashes regardless of
        // OS; split on both just in case a future adapter (or a non-Obsidian
        // host running these tests) yields native separators.
        const segments = path.split(/[\\/]/);
        return segments[segments.length - 1] ?? path;
      });
    } catch {
      return [];
    }
  }

  /**
   * Delete the run's sidecar directory. Called after a successful terminal
   * snapshot lands in the work-order note so the sidecar's job (covering live
   * runs) is over. Best-effort: a missing dir, or a transient delete failure,
   * is not fatal — orphan recovery will treat the absent heartbeat as stale
   * and the run is already terminal in the note.
   */
  async cleanupRun(runId: string): Promise<void> {
    try {
      if (await this.adapter.exists(this.runDir(runId))) {
        await this.adapter.rmdir(this.runDir(runId), true);
      }
    } catch {
      // Sidecar removal is non-essential; swallow so the terminal path stays clean.
    }
    // Drop the memoized mkdir promise so a future re-use of the same runId
    // (rare, but possible in tests) re-creates the dir cleanly.
    this.runDirReady.delete(runId);
  }

  private async ensureBaseDir(): Promise<void> {
    if (this.baseDirReady) return this.baseDirReady;
    this.baseDirReady = (async () => {
      // Walk the base path one segment at a time. Obsidian's DataAdapter.mkdir
      // is non-recursive, so on a fresh vault `.claudian` itself doesn't exist
      // and the leaf mkdir silently no-ops while subsequent writes fail.
      const segments = this.baseDir.split('/').filter((s) => s.length > 0);
      let current = '';
      for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        try {
          if (!(await this.adapter.exists(current))) {
            await this.adapter.mkdir(current);
          }
        } catch (error) {
          // Race: another writer created the dir between exists() and mkdir().
          // Treat EEXIST as success; rethrow anything else.
          if (!isAlreadyExists(error)) throw error;
        }
      }
    })();
    return this.baseDirReady;
  }

  private async ensureRunDir(runId: string): Promise<void> {
    const cached = this.runDirReady.get(runId);
    if (cached) return cached;
    const pending = (async () => {
      await this.ensureBaseDir();
      try {
        if (!(await this.adapter.exists(this.runDir(runId)))) {
          await this.adapter.mkdir(this.runDir(runId));
        }
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    })();
    this.runDirReady.set(runId, pending);
    try {
      await pending;
    } catch (error) {
      // Don't cache a failure: next call should retry.
      this.runDirReady.delete(runId);
      throw error;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /EEXIST|already exists/i.test(message);
}
