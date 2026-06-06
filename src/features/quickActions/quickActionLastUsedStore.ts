import type { ProviderId } from '@/core/providers/types';

export const PERSISTED_SCHEMA_VERSION = 1;

export interface LastUsedEntry {
  providerId: ProviderId;
  model: string;
  updatedAt: number;
}

interface PersistedShape {
  schemaVersion: number;
  writtenAt: number;
  entries: Record<string, LastUsedEntry>;
}

/**
 * Serialize the in-memory last-used map into the on-disk JSON envelope
 * (`schemaVersion` + `writtenAt` + `entries`) consumed by {@link parsePersistedLastUsed}.
 */
export function serializePersistedLastUsed(
  entries: Map<string, LastUsedEntry>,
  writtenAt: number,
): string {
  const out: PersistedShape = {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    writtenAt,
    entries: {},
  };
  for (const [stem, entry] of entries) {
    out.entries[stem] = { ...entry };
  }
  return JSON.stringify(out);
}

/**
 * Parse the on-disk last-used cache. Returns `null` for malformed JSON, a
 * schema-version mismatch, or a missing entries object; individual entries that
 * fail field validation are silently dropped so a partial corruption does not
 * blank the entire cache.
 */
export function parsePersistedLastUsed(raw: string): Map<string, LastUsedEntry> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const shape = parsed as Partial<PersistedShape>;
  if (shape.schemaVersion !== PERSISTED_SCHEMA_VERSION) return null;
  if (!shape.entries || typeof shape.entries !== 'object') return null;

  const out = new Map<string, LastUsedEntry>();
  for (const [stem, value] of Object.entries(shape.entries)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<LastUsedEntry>;
    if (typeof entry.providerId !== 'string') continue;
    if (typeof entry.model !== 'string') continue;
    if (typeof entry.updatedAt !== 'number') continue;
    out.set(stem, {
      providerId: entry.providerId as ProviderId,
      model: entry.model,
      updatedAt: entry.updatedAt,
    });
  }
  return out;
}

export interface LastUsedAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export interface LastUsedLogger {
  warn(...args: unknown[]): void;
}

export interface QuickActionLastUsedStoreOptions {
  adapter: LastUsedAdapter;
  cachePath?: string;
  debounceMs?: number;
  logger: LastUsedLogger;
  now?: () => number;
}

const DEFAULT_CACHE_PATH = '.claudian/cache/quick-action-last-used.json';
const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Tracks the most recently chosen `{ providerId, model }` per quick-action stem
 * so the prompt modal can preselect the user's last choice. Hydrates lazily
 * from a JSON cache file, holds the working set in memory, and persists writes
 * behind a trailing debounce. The owner is the plugin (one instance per app
 * lifetime); `flush()` should be awaited from `onunload` so a pending write is
 * not lost when Obsidian tears the plugin down.
 */
export class QuickActionLastUsedStore {
  private readonly adapter: LastUsedAdapter;
  private readonly cachePath: string;
  private readonly debounceMs: number;
  private readonly logger: LastUsedLogger;
  private readonly now: () => number;

  private entries = new Map<string, LastUsedEntry>();
  private hydrated = false;
  private dirty = false;
  private pendingWrite: Promise<void> | null = null;
  private debounceTimer: number | null = null;

  constructor(options: QuickActionLastUsedStoreOptions) {
    this.adapter = options.adapter;
    this.cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Load the cache file into memory once. Idempotent; a missing or malformed
   * file is treated as a cold start (warn-logged, no throw).
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      if (!(await this.adapter.exists(this.cachePath))) return;
      const raw = await this.adapter.read(this.cachePath);
      const parsed = parsePersistedLastUsed(raw);
      if (!parsed) {
        this.logger.warn(`[quickActionLastUsedStore] malformed cache at ${this.cachePath}, starting cold`);
        return;
      }
      this.entries = parsed;
    } catch (error) {
      this.logger.warn(`[quickActionLastUsedStore] hydrate failed`, error);
    }
  }

  get(stem: string): LastUsedEntry | null {
    return this.entries.get(stem) ?? null;
  }

  /**
   * Record a fresh choice for `stem`, updating the in-memory map immediately
   * and arming a debounced disk write.
   */
  set(stem: string, choice: { providerId: ProviderId; model: string }): void {
    this.entries.set(stem, {
      providerId: choice.providerId,
      model: choice.model,
      updatedAt: this.now(),
    });
    this.dirty = true;
    this.scheduleWrite();
  }

  /**
   * Remove a stale entry (e.g. provider got disabled or the recorded model is
   * no longer available) and arm a debounced disk write.
   */
  delete(stem: string): void {
    if (!this.entries.delete(stem)) return;
    this.dirty = true;
    this.scheduleWrite();
  }

  /**
   * Cancel the debounce timer, await any in-flight write, then synchronously
   * persist if still dirty. Call from `onunload` to avoid losing buffered work.
   */
  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingWrite) {
      await this.pendingWrite;
    }
    if (this.dirty) {
      await this.persistNow();
    }
  }

  private scheduleWrite(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.persistNow();
    }, this.debounceMs);
  }

  private async persistNow(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const snapshot = new Map(this.entries);
    const writtenAt = this.now();
    const payload = serializePersistedLastUsed(snapshot, writtenAt);
    const write = this.adapter
      .write(this.cachePath, payload)
      .catch((error) => {
        this.logger.warn(`[quickActionLastUsedStore] write failed`, error);
        this.dirty = true;
      });
    this.pendingWrite = write;
    try {
      await write;
    } finally {
      this.pendingWrite = null;
    }
  }
}
