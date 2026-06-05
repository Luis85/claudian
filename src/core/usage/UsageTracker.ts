import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/Logger';
import type { UsageEventMap } from './events';
import { serializeKey } from './keys';
import {
  USAGE_INDEX_SCHEMA_VERSION,
  type UsageIndex,
  type UsageKey,
  type UsageRecord,
} from './types';
import type { UsageStorage } from './UsageStorage';

const DEBOUNCE_MS = 1_000;

export class UsageTracker {
  private records = new Map<string, UsageRecord>();
  private dirty = false;
  private writeTimer: number | null = null;
  private readonly unsubRecorded: () => void;
  private readonly unsubCleared: () => void;
  private disposed = false;

  constructor(
    private events: EventBus<UsageEventMap>,
    private storage: UsageStorage,
    private now: () => number,
    private logger: Logger,
  ) {
    this.unsubRecorded = events.on('usage.recorded', (payload) => {
      this.handleRecord(payload);
    });
    this.unsubCleared = events.on('usage.cleared', () => {
      this.handleClear();
    });
  }

  async hydrate(): Promise<void> {
    const index = await this.storage.load();
    this.records.clear();
    for (const [key, value] of Object.entries(index.records)) {
      this.records.set(key, { count: value.count, lastUsedAt: value.lastUsedAt });
    }
  }

  get(key: UsageKey): UsageRecord | undefined {
    return this.records.get(serializeKey(key));
  }

  /**
   * Read-only snapshot. Callers iterate; mutations are ignored — they would
   * not affect the live map nor trigger a write.
   */
  getAll(): ReadonlyMap<string, UsageRecord> {
    return this.records;
  }

  async flush(): Promise<void> {
    if (this.writeTimer !== null) {
      window.clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    await this.storage.save(this.snapshot());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubRecorded();
    this.unsubCleared();
    if (this.writeTimer !== null) {
      window.clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
  }

  private handleRecord(payload: UsageEventMap['usage.recorded']): void {
    const key = serializeKey({
      kind: payload.kind,
      name: payload.name,
      providerId: payload.providerId,
    });
    const prev = this.records.get(key);
    this.records.set(key, {
      count: (prev?.count ?? 0) + 1,
      lastUsedAt: this.now(),
    });
    this.markDirty();
  }

  private handleClear(): void {
    this.records.clear();
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.writeTimer !== null) return;
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      void this.storage.save(this.snapshot()).catch((err) => {
        this.logger.scope('usage').warn('debounced usage write failed', err);
      });
    }, DEBOUNCE_MS);
  }

  private snapshot(): UsageIndex {
    // All keys in `this.records` originated from `serializeKey()` (see
    // `handleRecord`), so no defensive parse is needed at persist time.
    const records: Record<string, UsageRecord> = {};
    for (const [key, value] of this.records) {
      records[key] = { count: value.count, lastUsedAt: value.lastUsedAt };
    }
    return { version: USAGE_INDEX_SCHEMA_VERSION, records };
  }
}
