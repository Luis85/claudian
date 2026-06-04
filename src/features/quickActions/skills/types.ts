import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderId } from '../../../core/providers/types';

/**
 * A vault-discovered skill surfaced in the Quick Actions modal Skills tab.
 * Aggregated from every registered provider's command catalog.
 */
export interface SkillTabEntry {
  /** Aggregator-assigned ID, unique across providers, e.g. "claude:skill-tdd". */
  id: string;
  providerId: ProviderId;
  providerDisplayName: string;
  /** Skill name as invoked in chat (without prefix). */
  name: string;
  description: string;
  /** Provider-native trigger prefix. From ProviderCommandEntry.insertPrefix. */
  insertPrefix: '/' | '$';
  /** SKILL.md path when known. null for runtime-discovered (e.g. Opencode). */
  sourceFilePath: string | null;
  /**
   * Cached at listing time. Reflects provider-enable state when the modal
   * opened; used to dim disabled rows in the picker. `runVaultSkill`
   * re-checks `ProviderRegistry.isEnabled` at execution so a provider
   * toggled while the modal was open is honored.
   */
  providerEnabled: boolean;
}

/**
 * Aggregator's per-provider view. The factory injected into `VaultSkillAggregator`
 * builds one of these for every registered provider before listing skills.
 */
export interface ProviderRecord {
  providerId: ProviderId;
  displayName: string;
  isEnabled: boolean;
  commandCatalog: ProviderCommandCatalog;
}

/**
 * Minimal interface the Skills tab needs from a skill source. Lets the modal
 * couple to behavior, not to the concrete `VaultSkillAggregator` class, and
 * gives tests a small seam without `as unknown` casts.
 */
export interface VaultSkillSource {
  listAll(): Promise<SkillTabEntry[]>;
}
