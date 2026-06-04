import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderId } from '../../../core/providers/types';

export const PERSISTED_SCHEMA_VERSION = 1;

interface PersistedShape {
  schemaVersion: number;
  writtenAt: number;
  buckets: Record<string, ProviderCommandEntry[]>;
}

/**
 * Serializes the in-memory per-provider buckets to a JSON string for
 * `.claudian/cache/skill-index.json`. Skill bodies (`content`) are stripped
 * before write — they are large and the Skills tab only renders metadata.
 * `runVaultSkill` re-reads the actual `SKILL.md` at execution time anyway.
 */
export function serializePersistedSkillIndex(
  buckets: Map<ProviderId, ProviderCommandEntry[]>,
  writtenAt: number,
): string {
  const out: PersistedShape = {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    writtenAt,
    buckets: {},
  };
  for (const [providerId, entries] of buckets) {
    out.buckets[providerId] = entries.map((e) => ({ ...e, content: '' }));
  }
  return JSON.stringify(out);
}

/**
 * Returns the deserialized per-provider buckets, or `null` if the JSON is
 * malformed, the schema version does not match, or required fields are
 * missing. Callers treat `null` as "cold cache" and continue normally.
 */
export function parsePersistedSkillIndex(
  raw: string,
): Map<ProviderId, ProviderCommandEntry[]> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const shape = parsed as Partial<PersistedShape>;
  if (shape.schemaVersion !== PERSISTED_SCHEMA_VERSION) return null;
  if (!shape.buckets || typeof shape.buckets !== 'object') return null;

  const out = new Map<ProviderId, ProviderCommandEntry[]>();
  for (const [providerId, entries] of Object.entries(shape.buckets)) {
    if (!Array.isArray(entries)) continue;
    out.set(providerId as ProviderId, entries as ProviderCommandEntry[]);
  }
  return out;
}
