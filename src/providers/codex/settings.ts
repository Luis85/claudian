import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import type { ProviderCustomModel } from '../../features/settings/customModels/CustomModelsTable';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import { CODEX_SPARK_MODEL } from './types/models';

export type CodexSafeMode = 'workspace-write' | 'read-only';
export type CodexReasoningSummary = 'auto' | 'concise' | 'detailed' | 'none';
export type CodexInstallationMethod = 'native-windows' | 'wsl';
export type HostnameInstallationMethods = Record<string, CodexInstallationMethod>;

function normalizeCodexInstallationMethod(value: unknown): CodexInstallationMethod {
  return value === 'wsl' ? 'wsl' : 'native-windows';
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface CodexProviderSettings {
  enabled: boolean;
  safeMode: CodexSafeMode;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  customModels: ProviderCustomModel[];
  reasoningSummary: CodexReasoningSummary;
  environmentVariables: string;
  environmentHash: string;
  installationMethod: CodexInstallationMethod;
  installationMethodsByHost: HostnameInstallationMethods;
  wslDistroOverride: string;
  wslDistroOverridesByHost: HostnameCliPaths;
}

export const DEFAULT_CODEX_PROVIDER_SETTINGS: Readonly<CodexProviderSettings> = Object.freeze({
  enabled: false,
  safeMode: 'workspace-write',
  cliPath: '',
  cliPathsByHost: {},
  customModels: [] as ProviderCustomModel[],
  reasoningSummary: 'detailed',
  environmentVariables: '',
  environmentHash: '',
  installationMethod: 'native-windows',
  installationMethodsByHost: {},
  wslDistroOverride: '',
  wslDistroOverridesByHost: {},
});

// Backwards-compatible read: accept both the legacy newline-delimited string
// form and the new array form. F9 migrates persisted data; F8 must keep
// existing string-shaped values usable in the meantime.
function normalizeCustomModels(value: unknown): ProviderCustomModel[] {
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

  if (typeof value === 'string') {
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

export function shouldDisableCodexReasoningSummary(model: string | undefined): boolean {
  return model === CODEX_SPARK_MODEL;
}

export function getEffectiveCodexReasoningSummary(
  settings: Record<string, unknown>,
  model: string | undefined,
): CodexReasoningSummary {
  if (shouldDisableCodexReasoningSummary(model)) {
    return 'none';
  }

  return getCodexProviderSettings(settings).reasoningSummary;
}

export function applyCodexModelDefaults(
  model: string,
  settings: Record<string, unknown>,
): void {
  if (shouldDisableCodexReasoningSummary(model)) {
    updateCodexProviderSettings(settings, { reasoningSummary: 'none' });
  }
}

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

function normalizeInstallationMethodsByHost(value: unknown): HostnameInstallationMethods {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameInstallationMethods = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key === 'string' && key.trim()) {
      result[key] = normalizeCodexInstallationMethod(entry);
    }
  }
  return result;
}

export function getCodexProviderSettings(
  settings: Record<string, unknown>,
): CodexProviderSettings {
  const config = getProviderConfig(settings, 'codex');
  const hostnameKey = getHostnameKey();
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost ?? settings.codexCliPathsByHost);
  const normalizedInstallationMethodsByHost = normalizeInstallationMethodsByHost(config.installationMethodsByHost);
  const normalizedWslDistroOverridesByHost = normalizeHostnameCliPaths(config.wslDistroOverridesByHost);
  const hasLegacyHostnameKeyedSettings = Object.keys(normalizedCliPathsByHost).length > 0
    || Object.keys(normalizedInstallationMethodsByHost).length > 0
    || Object.keys(normalizedWslDistroOverridesByHost).length > 0;
  const legacyHostnameKey = hasLegacyHostnameKeyedSettings ? getLegacyHostnameKey() : '';
  const cliPathsByHost = hasLegacyHostnameKeyedSettings
    ? migrateLegacyHostnameKeyedMap(normalizedCliPathsByHost, hostnameKey, legacyHostnameKey)
    : normalizedCliPathsByHost;
  const installationMethodsByHost = hasLegacyHostnameKeyedSettings
    ? migrateLegacyHostnameKeyedMap(normalizedInstallationMethodsByHost, hostnameKey, legacyHostnameKey)
    : normalizedInstallationMethodsByHost;
  const wslDistroOverridesByHost = hasLegacyHostnameKeyedSettings
    ? migrateLegacyHostnameKeyedMap(normalizedWslDistroOverridesByHost, hostnameKey, legacyHostnameKey)
    : normalizedWslDistroOverridesByHost;
  const hasHostScopedInstallationMethods = Object.keys(installationMethodsByHost).length > 0;
  const hasHostScopedWslDistroOverrides = Object.keys(wslDistroOverridesByHost).length > 0;
  const legacyInstallationMethod = normalizeCodexInstallationMethod(config.installationMethod);
  const legacyWslDistroOverride = normalizeOptionalString(config.wslDistroOverride);

  return {
    enabled: (config.enabled as boolean | undefined)
      ?? (settings.codexEnabled as boolean | undefined)
      ?? DEFAULT_CODEX_PROVIDER_SETTINGS.enabled,
    safeMode: (config.safeMode as CodexSafeMode | undefined)
      ?? (settings.codexSafeMode as CodexSafeMode | undefined)
      ?? DEFAULT_CODEX_PROVIDER_SETTINGS.safeMode,
    cliPath: (config.cliPath as string | undefined)
      ?? (settings.codexCliPath as string | undefined)
      ?? DEFAULT_CODEX_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    customModels: normalizeCustomModels(config.customModels),
    reasoningSummary: (config.reasoningSummary as CodexReasoningSummary | undefined)
      ?? (settings.codexReasoningSummary as CodexReasoningSummary | undefined)
      ?? DEFAULT_CODEX_PROVIDER_SETTINGS.reasoningSummary,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'codex')
      ?? DEFAULT_CODEX_PROVIDER_SETTINGS.environmentVariables,
    environmentHash: (config.environmentHash as string | undefined)
      ?? (settings.lastCodexEnvHash as string | undefined)
      ?? DEFAULT_CODEX_PROVIDER_SETTINGS.environmentHash,
    installationMethod: installationMethodsByHost[hostnameKey]
      ?? (
        hasHostScopedInstallationMethods
          ? DEFAULT_CODEX_PROVIDER_SETTINGS.installationMethod
          : legacyInstallationMethod
      ),
    installationMethodsByHost,
    wslDistroOverride: wslDistroOverridesByHost[hostnameKey]
      ?? (
        hasHostScopedWslDistroOverrides
          ? DEFAULT_CODEX_PROVIDER_SETTINGS.wslDistroOverride
          : legacyWslDistroOverride
      ),
    wslDistroOverridesByHost,
  };
}

export function updateCodexProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<CodexProviderSettings>,
): CodexProviderSettings {
  const current = getCodexProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const installationMethodsByHost = 'installationMethodsByHost' in updates
    ? normalizeInstallationMethodsByHost(updates.installationMethodsByHost)
    : { ...current.installationMethodsByHost };
  const wslDistroOverridesByHost = 'wslDistroOverridesByHost' in updates
    ? normalizeHostnameCliPaths(updates.wslDistroOverridesByHost)
    : { ...current.wslDistroOverridesByHost };

  if (
    Object.keys(installationMethodsByHost).length === 0
    && current.installationMethod !== DEFAULT_CODEX_PROVIDER_SETTINGS.installationMethod
  ) {
    installationMethodsByHost[hostnameKey] = current.installationMethod;
  }

  if (
    Object.keys(wslDistroOverridesByHost).length === 0
    && current.wslDistroOverride
  ) {
    wslDistroOverridesByHost[hostnameKey] = current.wslDistroOverride;
  }

  if ('installationMethod' in updates) {
    installationMethodsByHost[hostnameKey] = normalizeCodexInstallationMethod(updates.installationMethod);
  }

  if ('wslDistroOverride' in updates) {
    const normalizedDistroOverride = normalizeOptionalString(updates.wslDistroOverride);
    if (normalizedDistroOverride) {
      wslDistroOverridesByHost[hostnameKey] = normalizedDistroOverride;
    } else {
      delete wslDistroOverridesByHost[hostnameKey];
    }
  }

  const next: CodexProviderSettings = {
    ...current,
    ...updates,
    installationMethod: installationMethodsByHost[hostnameKey]
      ?? DEFAULT_CODEX_PROVIDER_SETTINGS.installationMethod,
    installationMethodsByHost,
    wslDistroOverride: wslDistroOverridesByHost[hostnameKey]
      ?? DEFAULT_CODEX_PROVIDER_SETTINGS.wslDistroOverride,
    wslDistroOverridesByHost,
  };

  setProviderConfig(settings, 'codex', {
    enabled: next.enabled,
    safeMode: next.safeMode,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    customModels: next.customModels,
    reasoningSummary: next.reasoningSummary,
    environmentVariables: next.environmentVariables,
    environmentHash: next.environmentHash,
    installationMethodsByHost,
    wslDistroOverridesByHost,
  });
  return next;
}
