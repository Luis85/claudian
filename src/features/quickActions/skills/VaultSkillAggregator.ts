import type { Logger } from '../../../core/logging/Logger';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderId } from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import {
  parsePersistedSkillIndex,
  serializePersistedSkillIndex,
} from './skillIndexPersistence';
import type {
  ProviderRecord,
  SkillTabEntry,
  VaultSkillAggregatorOptions,
  VaultSkillSource,
} from './types';

interface CachedBucket {
  entries: ProviderCommandEntry[];
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const PERSIST_DEBOUNCE_MS = 1_000;
const DEFAULT_CACHE_PATH = '.specorator/cache/skill-index.json';

/**
 * Walks every provider record returned by the injected factory, asks each
 * provider's `ProviderCommandCatalog.listVaultEntries()` for skill-kind
 * entries, and tags them with provider metadata for the Skills tab.
 *
 * Per-provider failures are swallowed so a single broken provider cannot
 * blank out the entire Skills tab. When a `logger` is supplied, the failure
 * is logged at warn level under the `quickActions` scope.
 *
 * Raw `ProviderCommandEntry[]` buckets are cached per provider for `ttlMs`
 * so the modal can re-open without rehitting disk. Provider metadata
 * (`providerEnabled`, `providerDisplayName`) is re-evaluated from the live
 * `ProviderRecord` on every `listAll()` call so a provider toggled while
 * the cache is warm is reflected without invalidation.
 *
 * When an `eventBus` is supplied, the aggregator subscribes to
 * `vaultSkill.changed` and invalidates the matching provider's bucket so
 * vault edits propagate without a manual refresh. `dispose()` unsubscribes.
 */
export class VaultSkillAggregator implements VaultSkillSource {
  private readonly logger?: Logger;
  private readonly ttlMs: number;
  private readonly nowMs: () => number;
  private readonly cache = new Map<ProviderId, CachedBucket>();
  private readonly inFlight = new Map<ProviderId, Promise<ProviderCommandEntry[]>>();
  private eventBusUnsubscribe: (() => void) | undefined;
  private readonly cacheAdapter?: VaultFileAdapter;
  private readonly cachePath: string;
  private persistTimer: number | null = null;

  constructor(
    private getProviderRecords: () => ProviderRecord[],
    options: VaultSkillAggregatorOptions = {},
  ) {
    this.logger = options.logger?.scope('quickActions');
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.nowMs = options.nowMs ?? Date.now;
    if (options.eventBus) {
      this.eventBusUnsubscribe = options.eventBus.on(
        'vaultSkill.changed',
        ({ providerId }) => this.invalidate(providerId),
      );
    }
    this.cacheAdapter = options.cacheAdapter;
    this.cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
  }

  /**
   * Populates the in-memory cache from the persisted skill index on disk.
   *
   * No-ops when no `cacheAdapter` was supplied or when the cache file does
   * not exist. When the file is present but the contents are malformed or
   * the schema version does not match, the failure is swallowed and a
   * `warn` breadcrumb is emitted; callers continue with a cold cache.
   */
  async hydrate(): Promise<void> {
    if (!this.cacheAdapter) return;
    try {
      if (!(await this.cacheAdapter.exists(this.cachePath))) return;
      const raw = await this.cacheAdapter.read(this.cachePath);
      const buckets = parsePersistedSkillIndex(raw);
      if (!buckets) {
        this.logger?.warn('skill index hydrate skipped: malformed or schema mismatch');
        return;
      }
      const expiresAt = this.nowMs() + this.ttlMs;
      for (const [providerId, entries] of buckets) {
        this.cache.set(providerId, { entries, expiresAt });
      }
    } catch (err) {
      this.logger?.warn('skill index hydrate failed', { err });
    }
  }

  async listAll(): Promise<SkillTabEntry[]> {
    const records = this.getProviderRecords();
    const buckets = await Promise.all(
      records.map((r) => this.fetchBucket(r).then((raw) => this.mapBucket(raw, r))),
    );
    return buckets.flat();
  }

  listCachedNow(): SkillTabEntry[] {
    const records = this.getProviderRecords();
    const out: SkillTabEntry[] = [];
    for (const record of records) {
      const cached = this.cache.get(record.providerId);
      if (!cached) continue;
      out.push(...this.mapBucket(cached.entries, record));
    }
    return out;
  }

  async listAllStreaming(
    onProviderResolved: (providerId: ProviderId, entries: SkillTabEntry[]) => void,
  ): Promise<void> {
    const records = this.getProviderRecords();
    await Promise.all(
      records.map(async (r) => {
        const raw = await this.fetchBucket(r);
        try {
          onProviderResolved(r.providerId, this.mapBucket(raw, r));
        } catch (err) {
          this.logger?.warn('skill stream callback threw', {
            providerId: r.providerId,
            err,
          });
        }
      }),
    );
  }

  invalidate(providerId?: ProviderId): void {
    if (providerId === undefined) {
      this.cache.clear();
      this.inFlight.clear();
    } else {
      this.cache.delete(providerId);
      this.inFlight.delete(providerId);
    }
  }

  dispose(): void {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
      // Snapshot built synchronously before any await — safe to clear cache afterwards.
      void this.flushPersist();
    }
    this.eventBusUnsubscribe?.();
    this.eventBusUnsubscribe = undefined;
    this.cache.clear();
    this.inFlight.clear();
  }

  /** Trailing-edge debounce: collapse near-simultaneous fetches into a single write. */
  private schedulePersist(): void {
    if (!this.cacheAdapter) return;
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Snapshot the in-memory cache and write the index. Failures logged at warn; never throws. */
  private async flushPersist(): Promise<void> {
    if (!this.cacheAdapter) return;
    const buckets = new Map<ProviderId, ProviderCommandEntry[]>();
    for (const [providerId, bucket] of this.cache) {
      buckets.set(providerId, bucket.entries);
    }
    const body = serializePersistedSkillIndex(buckets, this.nowMs());
    try {
      await this.cacheAdapter.write(this.cachePath, body);
    } catch (err) {
      this.logger?.warn('skill index persist failed', { err });
    }
  }

  /** Returns the raw cached or freshly-fetched provider entries (skill kind). */
  private fetchBucket(record: ProviderRecord): Promise<ProviderCommandEntry[]> {
    const now = this.nowMs();
    const cached = this.cache.get(record.providerId);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.entries);
    }
    const existing = this.inFlight.get(record.providerId);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const all = await record.commandCatalog.listVaultEntries();
        const raw = all.filter((e) => e.kind === 'skill');
        this.cache.set(record.providerId, {
          entries: raw,
          expiresAt: this.nowMs() + this.ttlMs,
        });
        this.schedulePersist();
        return raw;
      } catch (err) {
        this.logger?.warn('vault skill aggregation failed', {
          providerId: record.providerId,
          err,
        });
        // Cache empty so we don't thrash retries within TTL
        this.cache.set(record.providerId, {
          entries: [],
          expiresAt: this.nowMs() + this.ttlMs,
        });
        this.schedulePersist();
        return [];
      } finally {
        this.inFlight.delete(record.providerId);
      }
    })();
    this.inFlight.set(record.providerId, promise);
    return promise;
  }

  private mapBucket(
    raw: ProviderCommandEntry[],
    record: ProviderRecord,
  ): SkillTabEntry[] {
    return raw
      .map((e) => this.mapEntry(e, record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private mapEntry(
    entry: ProviderCommandEntry,
    record: ProviderRecord,
  ): SkillTabEntry {
    const prefix = entry.insertPrefix === '$' ? '$' : '/';
    return {
      id: `${record.providerId}:${entry.id}`,
      providerId: record.providerId,
      providerDisplayName: record.displayName,
      name: entry.name,
      description: entry.description ?? '',
      insertPrefix: prefix,
      sourceFilePath: entry.sourceFilePath ?? null,
      providerEnabled: record.isEnabled,
    };
  }
}
