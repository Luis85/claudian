import type { Logger } from '../logging/Logger';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import { parseKey } from './keys';
import { USAGE_INDEX_SCHEMA_VERSION, type UsageIndex, type UsageRecord } from './types';

const DEFAULT_PATH = '.claudian/usage.json';
const CORRUPT_PATH = '.claudian/usage.corrupt.json';

export class UsageStorage {
  constructor(
    private adapter: VaultFileAdapter,
    private logger: Logger,
    private path: string = DEFAULT_PATH,
    private corruptPath: string = CORRUPT_PATH,
  ) {}

  async load(): Promise<UsageIndex> {
    const scope = this.logger.scope('usage');
    try {
      if (!(await this.adapter.exists(this.path))) {
        return coldStart();
      }
      const raw = await this.adapter.read(this.path);
      const parsed = this.parse(raw);
      if (parsed) return parsed;

      scope.warn('usage.json malformed or version mismatch, backing up + resetting');
      try {
        await this.adapter.write(this.corruptPath, raw);
      } catch (err) {
        scope.warn('failed to back up malformed usage.json', err);
      }
      return coldStart();
    } catch (err) {
      scope.warn('failed to read usage.json, treating as cold start', err);
      return coldStart();
    }
  }

  async save(index: UsageIndex): Promise<void> {
    const scope = this.logger.scope('usage');
    try {
      // Enrich each record with the name field (derived from key) so the stored
      // JSON is human-readable and search-friendly without changing UsageRecord.
      const enriched: Record<string, UsageRecord & { name?: string }> = {};
      for (const [key, rec] of Object.entries(index.records)) {
        const parsed = parseKey(key);
        enriched[key] = parsed ? { ...rec, name: parsed.name } : { ...rec };
      }
      const json = JSON.stringify({ version: index.version, records: enriched });
      await this.adapter.write(this.path, json);
    } catch (err) {
      scope.warn('failed to write usage.json', err);
    }
  }

  private parse(raw: string): UsageIndex | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<UsageIndex>;
    if (candidate.version !== USAGE_INDEX_SCHEMA_VERSION) return null;
    if (!candidate.records || typeof candidate.records !== 'object') return null;

    const records: Record<string, UsageRecord> = {};
    for (const [key, value] of Object.entries(candidate.records)) {
      if (!value || typeof value !== 'object') continue;
      const rec = value as Partial<UsageRecord>;
      if (typeof rec.count !== 'number' || typeof rec.lastUsedAt !== 'number') continue;
      records[key] = { count: rec.count, lastUsedAt: rec.lastUsedAt };
    }
    return { version: USAGE_INDEX_SCHEMA_VERSION, records };
  }
}

function coldStart(): UsageIndex {
  return { version: USAGE_INDEX_SCHEMA_VERSION, records: {} };
}
