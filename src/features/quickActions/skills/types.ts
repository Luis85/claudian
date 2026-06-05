import type { ClaudianEventMap } from '../../../app/events/claudianEvents';
import type { EventBus } from '../../../core/events/EventBus';
import type { Logger } from '../../../core/logging/Logger';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderId } from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';

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
 * Read API consumed by `SkillsTabRenderer`.
 *
 * - `listAll`: full async fetch (cache-aware). Convenience for callers that
 *   need every provider's entries in a single awaited result — used by
 *   tests and diagnostics. Production rendering goes through the streaming
 *   pair (`listCachedNow` + `listAllStreaming`).
 * - `listCachedNow`: synchronous, returns whatever is currently in the
 *   in-memory cache; empty if cold. Used for instant Phase-A paint.
 * - `listAllStreaming`: walks providers concurrently, fires `onProviderResolved`
 *   per provider as its fetch settles. Used for Phase-B refresh.
 * - `invalidate`: drop one bucket (with providerId) or all (without).
 * - `dispose`: unsubscribe EventBus, clear caches, flush pending persist.
 */
export interface VaultSkillSource {
  listAll(): Promise<SkillTabEntry[]>;
  listCachedNow(): SkillTabEntry[];
  listAllStreaming(
    onProviderResolved: (providerId: ProviderId, entries: SkillTabEntry[]) => void,
  ): Promise<void>;
  invalidate(providerId?: ProviderId): void;
  dispose(): void;
}

export interface VaultSkillAggregatorOptions {
  logger?: Logger;
  /** Defaults to 60_000 ms. */
  ttlMs?: number;
  /** When supplied, aggregator subscribes to `vaultSkill.changed`. */
  eventBus?: EventBus<ClaudianEventMap>;
  /** When supplied, aggregator hydrates from / persists to this adapter. */
  cacheAdapter?: VaultFileAdapter;
  /** Defaults to `.claudian/cache/skill-index.json`. */
  cachePath?: string;
  /** Clock injection for deterministic tests. Defaults to `Date.now`. */
  nowMs?: () => number;
}
