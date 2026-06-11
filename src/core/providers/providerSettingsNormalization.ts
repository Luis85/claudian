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
    const result: ProviderCustomModel[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (!id) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
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
      result.push(normalized);
    }
    return result;
  }

  if (options.acceptLegacyNewlineString && typeof value === 'string') {
    const result: ProviderCustomModel[] = [];
    const seen = new Set<string>();
    for (const line of value.split(/\r?\n/)) {
      const id = line.trim();
      if (!id) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ id, source: 'user' });
    }
    return result;
  }

  return [];
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
