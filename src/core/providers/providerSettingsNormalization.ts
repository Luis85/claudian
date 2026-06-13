import type { HostnameCliPaths, ProviderCustomModel } from '../types/settings';

/**
 * Defensive read shared by every provider's settings module: coerce persisted
 * customModels rows, dropping junk entries and case-insensitive duplicate ids.
 *
 * `acceptLegacyNewlineString` opts into the legacy newline-delimited string
 * form that Claude/Codex persisted before F9 migrated the data; Cursor and
 * Opencode never persisted that shape and treat strings as malformed.
 */
export function normalizeCustomModels(
  value: unknown,
  options: { acceptLegacyNewlineString?: boolean } = {},
): ProviderCustomModel[] {
  if (Array.isArray(value)) {
    return dedupeModelsById(value.map(normalizeCustomModelRow));
  }

  if (options.acceptLegacyNewlineString && typeof value === 'string') {
    const rows = value.split(/\r?\n/).map(normalizeLegacyModelLine);
    return dedupeModelsById(rows);
  }

  return [];
}

/** Coerce one persisted row into a model, or `null` for a junk/idless entry. */
function normalizeCustomModelRow(entry: unknown): ProviderCustomModel | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!id) return null;

  const normalized: ProviderCustomModel = {
    id,
    source: row.source === 'env' ? 'env' : 'user',
  };
  if (typeof row.label === 'string' && row.label.trim()) {
    normalized.label = row.label.trim();
  }
  if (typeof row.contextWindow === 'number' && Number.isFinite(row.contextWindow) && row.contextWindow > 0) {
    normalized.contextWindow = row.contextWindow;
  }
  return normalized;
}

/** Coerce one legacy newline-delimited line into a model, or `null` when blank. */
function normalizeLegacyModelLine(line: string): ProviderCustomModel | null {
  const id = line.trim();
  return id ? { id, source: 'user' } : null;
}

/** Drop `null` entries and case-insensitive duplicate ids, keeping first occurrence. */
function dedupeModelsById(rows: (ProviderCustomModel | null)[]): ProviderCustomModel[] {
  const result: ProviderCustomModel[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row) continue;
    const key = row.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

/** Coerces persisted data into a hostname -> trimmed CLI path map, dropping junk entries. */
export function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}
