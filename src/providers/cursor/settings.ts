import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
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

export interface CursorProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabledModelsByHost: HostnameEnabledModels;
  lastModel: string;
  environmentVariables: string;
  environmentHash: string;
}

export const DEFAULT_CURSOR_PROVIDER_SETTINGS: Readonly<CursorProviderSettings> = Object.freeze({
  enabled: false,
  cliPath: '',
  cliPathsByHost: {},
  enabledModelsByHost: {},
  lastModel: '',
  environmentVariables: '',
  environmentHash: '',
});

export function getCursorProviderSettings(settings: Record<string, unknown>): CursorProviderSettings {
  const config = getProviderConfig(settings, 'cursor');

  return {
    enabled: (config.enabled as boolean | undefined) ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.enabled,
    cliPath: (config.cliPath as string | undefined) ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    enabledModelsByHost: normalizeEnabledModelsByHost(config.enabledModelsByHost),
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
    enabledModelsByHost: 'enabledModelsByHost' in updates
      ? normalizeEnabledModelsByHost(updates.enabledModelsByHost)
      : { ...current.enabledModelsByHost },
  };

  setProviderConfig(settings, 'cursor', {
    enabled: next.enabled,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    enabledModelsByHost: next.enabledModelsByHost,
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
