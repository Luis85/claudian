import type { Logger } from '../../../core/logging/Logger';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderRecord, SkillTabEntry, VaultSkillSource } from './types';

/**
 * Optional dependencies for `VaultSkillAggregator`. A logger lets the
 * aggregator emit a `warn` breadcrumb when a single provider's
 * `listVaultEntries()` rejects, instead of silently swallowing.
 */
export interface VaultSkillAggregatorOptions {
  logger?: Logger;
}

/**
 * Walks every provider record returned by the injected factory, asks each
 * provider's `ProviderCommandCatalog.listVaultEntries()` for skill-kind
 * entries, and tags them with provider metadata for the Skills tab.
 *
 * Per-provider failures are swallowed so a single broken provider cannot
 * blank out the entire Skills tab. When a `logger` is supplied, the failure
 * is logged at warn level under the `quickActions` scope.
 */
export class VaultSkillAggregator implements VaultSkillSource {
  private readonly logger?: Logger;

  constructor(
    private getProviderRecords: () => ProviderRecord[],
    options: VaultSkillAggregatorOptions = {},
  ) {
    this.logger = options.logger?.scope('quickActions');
  }

  async listAll(): Promise<SkillTabEntry[]> {
    const records = this.getProviderRecords();
    const buckets = await Promise.all(
      records.map((r) =>
        this.collectFromProvider(r).catch((err) => {
          this.logger?.warn('vault skill aggregation failed', {
            providerId: r.providerId,
            err,
          });
          return [] as SkillTabEntry[];
        }),
      ),
    );
    return buckets.flat();
  }

  private async collectFromProvider(record: ProviderRecord): Promise<SkillTabEntry[]> {
    const entries = await record.commandCatalog.listVaultEntries();
    return entries
      .filter((e) => e.kind === 'skill')
      .map((e) => this.mapEntry(e, record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private mapEntry(entry: ProviderCommandEntry, record: ProviderRecord): SkillTabEntry {
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
