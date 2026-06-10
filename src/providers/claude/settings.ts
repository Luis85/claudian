import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import type { ProviderCustomModel } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';

export const CLAUDE_SAFE_MODES = ['acceptEdits', 'auto', 'default'] as const;
export type ClaudeSafeMode = typeof CLAUDE_SAFE_MODES[number];
export type ClaudeSettingSource = 'user' | 'project' | 'local';

export interface ClaudeProviderSettings {
  enabled: boolean;
  safeMode: ClaudeSafeMode;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  loadUserSettings: boolean;
  enableChrome: boolean;
  enableBangBash: boolean;
  enableOpus1M: boolean;
  enableSonnet1M: boolean;
  customModels: ProviderCustomModel[];
  lastModel: string;
  environmentVariables: string;
  environmentHash: string;
}

export const DEFAULT_CLAUDE_PROVIDER_SETTINGS: Readonly<ClaudeProviderSettings> = Object.freeze({
  enabled: false,
  safeMode: 'acceptEdits',
  cliPath: '',
  cliPathsByHost: {},
  loadUserSettings: true,
  enableChrome: false,
  enableBangBash: false,
  enableOpus1M: false,
  enableSonnet1M: false,
  customModels: [] as ProviderCustomModel[],
  lastModel: 'haiku',
  environmentVariables: '',
  environmentHash: '',
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

function normalizeClaudeSafeMode(value: unknown): ClaudeSafeMode | undefined {
  return (CLAUDE_SAFE_MODES as readonly unknown[]).includes(value)
    ? value as ClaudeSafeMode
    : undefined;
}

export function getClaudeProviderSettings(
  settings: Record<string, unknown>,
): ClaudeProviderSettings {
  const config = getProviderConfig(settings, 'claude');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(
    config.cliPathsByHost ?? settings.claudeCliPathsByHost,
  );
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    enabled: (config.enabled as boolean | undefined) ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.enabled,
    safeMode: normalizeClaudeSafeMode(config.safeMode)
      ?? normalizeClaudeSafeMode(settings.claudeSafeMode)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.safeMode,
    cliPath: (config.cliPath as string | undefined)
      ?? (settings.claudeCliPath as string | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    loadUserSettings: (config.loadUserSettings as boolean | undefined)
      ?? (settings.loadUserClaudeSettings as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.loadUserSettings,
    enableChrome: (config.enableChrome as boolean | undefined)
      ?? (settings.enableChrome as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.enableChrome,
    enableBangBash: (config.enableBangBash as boolean | undefined)
      ?? (settings.enableBangBash as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.enableBangBash,
    enableOpus1M: (config.enableOpus1M as boolean | undefined)
      ?? (settings.enableOpus1M as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.enableOpus1M,
    enableSonnet1M: (config.enableSonnet1M as boolean | undefined)
      ?? (settings.enableSonnet1M as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.enableSonnet1M,
    customModels: normalizeCustomModels(config.customModels),
    lastModel: (config.lastModel as string | undefined)
      ?? (settings.lastClaudeModel as string | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.lastModel,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'claude')
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.environmentVariables,
    environmentHash: (config.environmentHash as string | undefined)
      ?? (settings.lastEnvHash as string | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.environmentHash,
  };
}

/**
 * SECURITY (SEC-2): `project`/`local` setting sources load the vault's
 * `.claude/settings.json` (cwd is the vault), which can carry `hooks` and
 * `permissions.allow`. When the vault is untrusted and those settings are risky,
 * callers pass `honorProjectSettings: false` to withhold `project`/`local` so the
 * risky settings never reach the SDK. Vaults with no risky settings — and trusted
 * vaults — pass `true` (the default) and behave exactly as before.
 */
export function resolveClaudeSettingSources(
  loadUserSettings: boolean,
  honorProjectSettings = true,
): ClaudeSettingSource[] {
  const sources: ClaudeSettingSource[] = [];
  if (loadUserSettings) {
    sources.push('user');
  }
  if (honorProjectSettings) {
    sources.push('project', 'local');
  }
  return sources;
}

export function updateClaudeProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<ClaudeProviderSettings>,
): ClaudeProviderSettings {
  const current = getClaudeProviderSettings(settings);
  const next = {
    ...current,
    ...updates,
    safeMode: 'safeMode' in updates
      ? normalizeClaudeSafeMode(updates.safeMode) ?? current.safeMode
      : current.safeMode,
  };
  setProviderConfig(settings, 'claude', next);
  return next;
}
