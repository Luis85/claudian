import type { ProviderId } from '../providers/types';

export type UsageEntryKind = 'quickAction' | 'skill';

/**
 * Stable identifier for a tracked entry.
 *
 * - quickAction: filename stem (e.g. "summarize") — derived from filePath at
 *   emit time so YAML `name` renames do not create a new counter while the
 *   file is unchanged on disk.
 * - skill: skill folder name + owning providerId. Same skill name across
 *   providers (e.g. `$deep-research` for Claude and Codex) keeps separate
 *   counters.
 */
export interface UsageKey {
  kind: UsageEntryKind;
  name: string;
  providerId?: ProviderId;
}

export interface UsageRecord {
  count: number;
  lastUsedAt: number;
}

export const USAGE_INDEX_SCHEMA_VERSION = 1 as const;

export interface UsageIndex {
  version: typeof USAGE_INDEX_SCHEMA_VERSION;
  records: Record<string, UsageRecord>;
}
