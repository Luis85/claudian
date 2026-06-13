import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import {
  normalizeCustomModels,
  normalizeHostnameCliPaths,
} from '../../core/providers/providerSettingsNormalization';
import type { HostnameCliPaths } from '../../core/types/settings';
import type { ProviderCustomModel } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import {
  getOpencodeDiscoveryState,
  seedOpencodeDiscoveryStateFromLegacyConfig,
  updateOpencodeDiscoveryState,
} from './discoveryState';
import { ensureProviderProjectionMap } from './internal/providerProjection';
import {
  decodeOpencodeModelId,
  encodeOpencodeModelId,
  isOpencodeModelSelectionId,
  normalizeOpencodeThinkingOptionsByModel,
  OPENCODE_DEFAULT_THINKING_LEVEL,
  type OpencodeDiscoveredModel,
  type OpencodeThinkingOptionsByModel,
  resolveOpencodeBaseModelRawId,
} from './models';
import {
  normalizeManagedOpencodeSelectedMode,
  type OpencodeMode,
} from './modes';

export interface PersistedOpencodeProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  customModels: ProviderCustomModel[];
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  preferredThinkingByModel: Record<string, string>;
  selectedMode: string;
  thinkingOptionsByModel: OpencodeThinkingOptionsByModel;
  visibleModels: string[];
}

export interface OpencodeProviderSettings extends PersistedOpencodeProviderSettings {
  availableModes: OpencodeMode[];
  discoveredModels: OpencodeDiscoveredModel[];
}

export const OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES = 'OPENCODE_ENABLE_EXA=1';

export const DEFAULT_OPENCODE_PROVIDER_SETTINGS: Readonly<PersistedOpencodeProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  customModels: [] as ProviderCustomModel[],
  enabled: false,
  environmentHash: '',
  environmentVariables: OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES,
  modelAliases: {},
  preferredThinkingByModel: {},
  selectedMode: '',
  thinkingOptionsByModel: {},
  visibleModels: [],
});

export function normalizeOpencodeVisibleModels(
  value: unknown,
  discoveredModels: OpencodeDiscoveredModel[] = [],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = resolveOpencodeBaseModelRawId(entry.trim(), discoveredModels);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function normalizeOpencodeModelAliases(
  value: unknown,
  discoveredModels: OpencodeDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const normalizedRawId = resolveOpencodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedAlias = alias.trim();
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }

    normalized[normalizedRawId] = normalizedAlias;
  }

  return normalized;
}

export function normalizeOpencodePreferredThinkingByModel(
  value: unknown,
  discoveredModels: OpencodeDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, thinkingLevel] of Object.entries(value as Record<string, unknown>)) {
    if (typeof thinkingLevel !== 'string') {
      continue;
    }

    const normalizedRawId = resolveOpencodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedThinkingLevel = thinkingLevel.trim();
    if (!normalizedRawId || !normalizedThinkingLevel) {
      continue;
    }

    normalized[normalizedRawId] = normalizedThinkingLevel;
  }

  return normalized;
}

export function getOpencodeProviderSettings(
  settings: Record<string, unknown>,
): OpencodeProviderSettings {
  const config = getProviderConfig(settings, 'opencode');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;
  seedOpencodeDiscoveryStateFromLegacyConfig(settings, config);
  const discoveryState = getOpencodeDiscoveryState(settings);
  const availableModes = discoveryState.availableModes;
  const discoveredModels = discoveryState.discoveredModels;
  const persistedThinkingOptionsByModel = normalizeOpencodeThinkingOptionsByModel(
    config.thinkingOptionsByModel,
    discoveredModels,
  );
  const thinkingOptionsByModel = normalizeOpencodeThinkingOptionsByModel({
    ...persistedThinkingOptionsByModel,
    ...discoveryState.thinkingOptionsByModel,
  }, discoveredModels);

  return {
    availableModes,
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    customModels: normalizeCustomModels(config.customModels),
    discoveredModels,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'opencode')
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeOpencodeModelAliases(config.modelAliases, discoveredModels),
    preferredThinkingByModel: normalizeOpencodePreferredThinkingByModel(
      config.preferredThinkingByModel,
      discoveredModels,
    ),
    selectedMode: normalizeManagedOpencodeSelectedMode(config.selectedMode, availableModes),
    thinkingOptionsByModel,
    visibleModels: normalizeOpencodeVisibleModels(config.visibleModels, discoveredModels),
  };
}

export function updateOpencodeProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<OpencodeProviderSettings>,
): OpencodeProviderSettings {
  const current = getOpencodeProviderSettings(settings);
  syncOpencodeDiscoveryStateFromUpdates(settings, updates);

  const next = buildNextOpencodeSettings(settings, current, updates);

  if (updates.visibleModels !== undefined) {
    retargetRemovedOpencodeSelections(settings, next);
  }

  const persistedThinkingOptionsByModel = pruneThinkingOptionsToPersistedSelections(
    settings,
    next,
  );

  setProviderConfig(settings, 'opencode', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    customModels: next.customModels,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    modelAliases: next.modelAliases,
    preferredThinkingByModel: next.preferredThinkingByModel,
    selectedMode: next.selectedMode,
    thinkingOptionsByModel: persistedThinkingOptionsByModel,
    visibleModels: next.visibleModels,
  });

  return next;
}

/** Persist any discovery-derived fields (modes/models/thinking) carried on the update into shared discovery state. */
function syncOpencodeDiscoveryStateFromUpdates(
  settings: Record<string, unknown>,
  updates: Partial<OpencodeProviderSettings>,
): void {
  if (!('availableModes' in updates || 'discoveredModels' in updates || 'thinkingOptionsByModel' in updates)) {
    return;
  }
  updateOpencodeDiscoveryState(settings, {
    ...(updates.availableModes !== undefined ? { availableModes: updates.availableModes } : {}),
    ...(updates.discoveredModels !== undefined ? { discoveredModels: updates.discoveredModels } : {}),
    ...(updates.thinkingOptionsByModel !== undefined
      ? { thinkingOptionsByModel: updates.thinkingOptionsByModel }
      : {}),
  });
}

/**
 * Resolve the persisted hostname-keyed CLI map and the top-level cliPath. When a
 * bare `cliPath` is provided (without an explicit host map), it is folded into the
 * current host's entry and the top-level path is cleared.
 */
function resolveOpencodeCliPaths(
  current: OpencodeProviderSettings,
  updates: Partial<OpencodeProviderSettings>,
): { cliPath: string; cliPathsByHost: HostnameCliPaths } {
  const cliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let cliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_OPENCODE_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      cliPathsByHost[getHostnameKey()] = trimmedCliPath;
    } else {
      delete cliPathsByHost[getHostnameKey()];
    }
    cliPath = DEFAULT_OPENCODE_PROVIDER_SETTINGS.cliPath;
  }

  return { cliPath, cliPathsByHost };
}

/** Merge `current`, `updates`, and freshly-normalized derived fields into the next settings snapshot. */
function buildNextOpencodeSettings(
  settings: Record<string, unknown>,
  current: OpencodeProviderSettings,
  updates: Partial<OpencodeProviderSettings>,
): OpencodeProviderSettings {
  const discoveryState = getOpencodeDiscoveryState(settings);
  const nextAvailableModes = discoveryState.availableModes;
  const nextDiscoveredModels = discoveryState.discoveredModels;
  const nextThinkingOptionsByModel = updates.thinkingOptionsByModel !== undefined
    ? discoveryState.thinkingOptionsByModel
    : normalizeOpencodeThinkingOptionsByModel(
      current.thinkingOptionsByModel,
      nextDiscoveredModels,
    );
  const nextVisibleModels = normalizeOpencodeVisibleModels(
    updates.visibleModels ?? current.visibleModels,
    nextDiscoveredModels,
  );
  const { cliPath, cliPathsByHost } = resolveOpencodeCliPaths(current, updates);

  return {
    ...current,
    ...updates,
    availableModes: nextAvailableModes,
    cliPath,
    cliPathsByHost,
    customModels: 'customModels' in updates
      ? normalizeCustomModels(updates.customModels)
      : current.customModels,
    discoveredModels: nextDiscoveredModels,
    modelAliases: pruneModelAliasesToVisible(
      normalizeOpencodeModelAliases(
        updates.modelAliases ?? current.modelAliases,
        nextDiscoveredModels,
      ),
      nextVisibleModels,
    ),
    preferredThinkingByModel: normalizeOpencodePreferredThinkingByModel(
      updates.preferredThinkingByModel ?? current.preferredThinkingByModel,
      nextDiscoveredModels,
    ),
    selectedMode: normalizeManagedOpencodeSelectedMode(
      updates.selectedMode ?? current.selectedMode,
      nextAvailableModes,
    ),
    thinkingOptionsByModel: nextThinkingOptionsByModel,
    visibleModels: nextVisibleModels,
  };
}

export function hasLegacyOpencodeDiscoveryFields(settings: Record<string, unknown>): boolean {
  const config = getProviderConfig(settings, 'opencode');
  return 'availableModes' in config || 'discoveredModels' in config;
}

function pruneModelAliasesToVisible(
  aliases: Record<string, string>,
  visibleModels: string[],
): Record<string, string> {
  if (visibleModels.length === 0 || Object.keys(aliases).length === 0) {
    return {};
  }

  const visibleSet = new Set(visibleModels);
  const pruned: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(aliases)) {
    if (visibleSet.has(rawId)) {
      pruned[rawId] = alias;
    }
  }
  return pruned;
}

function pruneThinkingOptionsToPersistedSelections(
  settings: Record<string, unknown>,
  next: OpencodeProviderSettings,
): OpencodeThinkingOptionsByModel {
  const persistableRawIds = new Set(next.visibleModels);
  addPersistableSelection(persistableRawIds, settings.model, next.discoveredModels);
  addPersistableSelection(persistableRawIds, settings.titleGenerationModel, next.discoveredModels);

  const savedProviderModel = settings.savedProviderModel;
  if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
    addPersistableSelection(
      persistableRawIds,
      (savedProviderModel as Record<string, unknown>).opencode,
      next.discoveredModels,
    );
  }

  const pruned: OpencodeThinkingOptionsByModel = {};
  for (const rawId of persistableRawIds) {
    const options = next.thinkingOptionsByModel[rawId];
    if (options?.length) {
      pruned[rawId] = options.map((option) => ({ ...option }));
    }
  }
  return pruned;
}

function addPersistableSelection(
  target: Set<string>,
  value: unknown,
  discoveredModels: OpencodeDiscoveredModel[],
): void {
  if (typeof value !== 'string' || !isOpencodeModelSelectionId(value)) {
    return;
  }

  const rawModelId = decodeOpencodeModelId(value);
  if (!rawModelId) {
    return;
  }

  const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, discoveredModels);
  if (baseRawId) {
    target.add(baseRawId);
  }
}

function retargetRemovedOpencodeSelections(
  settings: Record<string, unknown>,
  next: OpencodeProviderSettings,
): void {
  if (next.visibleModels.length === 0) {
    if (
      typeof settings.titleGenerationModel === 'string'
      && isOpencodeModelSelectionId(settings.titleGenerationModel)
    ) {
      settings.titleGenerationModel = '';
    }
    return;
  }

  const visibleSet = new Set(next.visibleModels);
  const fallbackRawId = next.visibleModels[0];
  const fallbackModelId = encodeOpencodeModelId(fallbackRawId);
  const fallbackEffort = next.preferredThinkingByModel[fallbackRawId] ?? OPENCODE_DEFAULT_THINKING_LEVEL;

  const maybeRetargetModel = (value: unknown): string | null => {
    if (typeof value !== 'string' || !isOpencodeModelSelectionId(value)) {
      return null;
    }

    const rawModelId = decodeOpencodeModelId(value);
    if (!rawModelId) {
      return fallbackModelId;
    }

    const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, next.discoveredModels);
    return visibleSet.has(baseRawId) ? null : fallbackModelId;
  };

  const savedProviderModel = ensureProviderProjectionMap(settings, 'savedProviderModel');
  const nextSavedModel = maybeRetargetModel(savedProviderModel.opencode);
  if (nextSavedModel) {
    savedProviderModel.opencode = nextSavedModel;
    ensureProviderProjectionMap(settings, 'savedProviderEffort').opencode = fallbackEffort;
  }

  const nextTopLevelModel = maybeRetargetModel(settings.model);
  if (nextTopLevelModel) {
    settings.model = nextTopLevelModel;
    settings.effortLevel = fallbackEffort;
  }

  const nextTitleGenerationModel = maybeRetargetModel(settings.titleGenerationModel);
  if (nextTitleGenerationModel) {
    settings.titleGenerationModel = nextTitleGenerationModel;
  }
}
