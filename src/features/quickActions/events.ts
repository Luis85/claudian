import type { ProviderId } from '../../core/providers/types';

export interface QuickActionsEventMap {
  /**
   * Emitted by provider command catalogs after a skill-kind entry is saved
   * or deleted via in-app flows. The `VaultSkillAggregator` subscribes and
   * invalidates the matching provider bucket so the next Skills-tab open
   * shows fresh data without waiting for the TTL.
   *
   * External CLI edits (`SKILL.md` modified outside Obsidian) do NOT emit
   * this event — they rely on the aggregator's TTL fallback.
   */
  'vaultSkill.changed': { providerId: ProviderId };
}
