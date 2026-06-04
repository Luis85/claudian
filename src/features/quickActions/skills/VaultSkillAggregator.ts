import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderRecord, SkillTabEntry } from './types';

/**
 * Walks every provider record returned by the injected factory, asks each
 * provider's `ProviderCommandCatalog.listVaultEntries()` for skill-kind
 * entries, and tags them with provider metadata for the Skills tab.
 *
 * Per-provider failures are swallowed so a single broken provider cannot
 * blank out the entire Skills tab.
 */
export class VaultSkillAggregator {
  constructor(private getProviderRecords: () => ProviderRecord[]) {}

  async listAll(): Promise<SkillTabEntry[]> {
    const records = this.getProviderRecords();
    const buckets = await Promise.all(
      records.map((r) => this.collectFromProvider(r).catch(() => [] as SkillTabEntry[])),
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
