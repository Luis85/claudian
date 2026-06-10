import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import type { ProviderCustomModel } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

export type HostnameEnabledModels = Record<string, string[]>;

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
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

// Coerces arbitrary persisted data into a Record<string, string[]> of trimmed,
// non-empty, de-duplicated raw model ids. Junk keys/values are dropped.
export function normalizeEnabledModelsByHost(value: unknown): HostnameEnabledModels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameEnabledModels = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== 'string' || !key.trim() || !Array.isArray(entry)) {
      continue;
    }
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const candidate of entry) {
      if (typeof candidate !== 'string') {
        continue;
      }
      const trimmed = candidate.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      ids.push(trimmed);
    }
    result[key] = ids;
  }
  return result;
}

// Coerces persisted data into a Record<string, string> of family id -> mode.
// Drops empty keys/values.
export function normalizePreferredModeByFamily(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const familyId = typeof key === 'string' ? key.trim() : '';
    const mode = typeof entry === 'string' ? entry.trim() : '';
    if (!familyId || !mode) {
      continue;
    }
    result[familyId] = mode;
  }
  return result;
}

export interface CursorProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  customModels: ProviderCustomModel[];
  enabledModelsByHost: HostnameEnabledModels;
  preferredModeByFamily: Record<string, string>;
  lastModel: string;
  environmentVariables: string;
  environmentHash: string;
}

export const DEFAULT_CURSOR_PROVIDER_SETTINGS: Readonly<CursorProviderSettings> = Object.freeze({
  enabled: false,
  cliPath: '',
  cliPathsByHost: {},
  customModels: [] as ProviderCustomModel[],
  enabledModelsByHost: {},
  preferredModeByFamily: {},
  lastModel: '',
  environmentVariables: '',
  environmentHash: '',
});

// Cursor never persisted a legacy string-shaped customModels field, but we keep
// the same defensive normalizer for symmetry with Claude/Codex and to drop any
// junk entries that might appear in malformed configs.
function normalizeCustomModels(value: unknown): ProviderCustomModel[] {
  if (!Array.isArray(value)) {
    return [];
  }
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

export function getCursorProviderSettings(settings: Record<string, unknown>): CursorProviderSettings {
  const config = getProviderConfig(settings, 'cursor');

  return {
    enabled: (config.enabled as boolean | undefined) ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.enabled,
    cliPath: (config.cliPath as string | undefined) ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    customModels: normalizeCustomModels(config.customModels),
    enabledModelsByHost: normalizeEnabledModelsByHost(config.enabledModelsByHost),
    preferredModeByFamily: normalizePreferredModeByFamily(config.preferredModeByFamily),
    lastModel: (config.lastModel as string | undefined) ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.lastModel,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'cursor')
      ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.environmentVariables,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.environmentHash,
  };
}

export function updateCursorProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<CursorProviderSettings>,
): CursorProviderSettings {
  const current = getCursorProviderSettings(settings);
  const next: CursorProviderSettings = {
    ...current,
    ...updates,
    cliPathsByHost: updates.cliPathsByHost
      ? normalizeHostnameCliPaths(updates.cliPathsByHost)
      : { ...current.cliPathsByHost },
    customModels: 'customModels' in updates
      ? normalizeCustomModels(updates.customModels)
      : current.customModels,
    enabledModelsByHost: 'enabledModelsByHost' in updates
      ? normalizeEnabledModelsByHost(updates.enabledModelsByHost)
      : { ...current.enabledModelsByHost },
    preferredModeByFamily: 'preferredModeByFamily' in updates
      ? normalizePreferredModeByFamily(updates.preferredModeByFamily)
      : { ...current.preferredModeByFamily },
  };

  setProviderConfig(settings, 'cursor', {
    enabled: next.enabled,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    customModels: next.customModels,
    enabledModelsByHost: next.enabledModelsByHost,
    preferredModeByFamily: next.preferredModeByFamily,
    lastModel: next.lastModel,
    environmentVariables: next.environmentVariables,
    environmentHash: next.environmentHash,
  });
  return next;
}

// Raw (non-namespaced) model ids the user has curated for the current machine.
// Empty array means "no curation" → the picker shows only `auto` (+ env).
export function getCursorEnabledModels(settings: Record<string, unknown>): string[] {
  const { enabledModelsByHost } = getCursorProviderSettings(settings);
  return enabledModelsByHost[getHostnameKey()] ?? [];
}

// Persists the curated raw model ids for the current machine.
export function setCursorEnabledModels(
  settings: Record<string, unknown>,
  ids: string[],
): void {
  const current = getCursorProviderSettings(settings);
  const enabledModelsByHost = { ...current.enabledModelsByHost };
  const hostnameKey = getHostnameKey();

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of ids) {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  if (normalized.length > 0) {
    enabledModelsByHost[hostnameKey] = normalized;
  } else {
    delete enabledModelsByHost[hostnameKey];
  }

  updateCursorProviderSettings(settings, { enabledModelsByHost });
}
