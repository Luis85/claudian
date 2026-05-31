import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { asSettingsBag, type ClaudianSettings, type ProviderConfigMap } from '../../../core/types/settings';
import type { ProviderCustomModel } from '../../../features/settings/customModels/CustomModelsTable';

// Legacy maps lived as top-level fields on ClaudianSettings. F9 erases them
// in favour of per-provider customModels rows tagged with source 'env'.
// The function is pure and idempotent — after one run the legacy maps are
// empty so subsequent runs produce identical output.
export function migrateModelOverrides(settings: ClaudianSettings): ClaudianSettings {
  const contextLimits = normalizeContextLimits(settings.customContextLimits);
  const aliases = normalizeAliases(settings.customModelAliases);

  if (Object.keys(contextLimits).length === 0 && Object.keys(aliases).length === 0) {
    return ensureLegacyMapsCleared(settings);
  }

  const modelIds = new Set<string>([
    ...Object.keys(contextLimits),
    ...Object.keys(aliases),
  ]);

  const nextProviderConfigs = cloneProviderConfigs(settings.providerConfigs);

  for (const modelId of modelIds) {
    const ownerId = resolveOwningProvider(modelId, settings);
    if (!ownerId) {
      continue;
    }

    const existing = readCustomModels(nextProviderConfigs, ownerId);
    if (containsModelIdCaseInsensitive(existing, modelId)) {
      continue;
    }

    const entry: ProviderCustomModel = { id: modelId, source: 'env' };
    const label = aliases[modelId];
    if (label) {
      entry.label = label;
    }
    const contextWindow = contextLimits[modelId];
    if (typeof contextWindow === 'number') {
      entry.contextWindow = contextWindow;
    }

    writeCustomModels(nextProviderConfigs, ownerId, [...existing, entry]);
  }

  return {
    ...settings,
    providerConfigs: nextProviderConfigs,
    customContextLimits: {},
    customModelAliases: {},
  };
}

function ensureLegacyMapsCleared(settings: ClaudianSettings): ClaudianSettings {
  const contextEmpty = isEmptyRecord(settings.customContextLimits);
  const aliasesEmpty = isEmptyRecord(settings.customModelAliases);
  if (contextEmpty && aliasesEmpty) {
    if (settings.customContextLimits && settings.customModelAliases) {
      return settings;
    }
    return {
      ...settings,
      customContextLimits: settings.customContextLimits ?? {},
      customModelAliases: settings.customModelAliases ?? {},
    };
  }

  return {
    ...settings,
    customContextLimits: {},
    customModelAliases: {},
  };
}

function isEmptyRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return true;
  }
  return Object.keys(value as Record<string, unknown>).length === 0;
}

function normalizeContextLimits(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      const modelId = key.trim();
      if (modelId) {
        result[modelId] = raw;
      }
    }
  }
  return result;
}

function normalizeAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string') continue;
    const modelId = key.trim();
    const alias = raw.trim();
    if (modelId && alias) {
      result[modelId] = alias;
    }
  }
  return result;
}

function cloneProviderConfigs(value: unknown): ProviderConfigMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: ProviderConfigMap = {};
  for (const [providerId, config] of Object.entries(value as ProviderConfigMap)) {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      result[providerId] = { ...config };
    }
  }
  return result;
}

function readCustomModels(
  configs: ProviderConfigMap,
  providerId: ProviderId,
): ProviderCustomModel[] {
  const bag = configs[providerId];
  const list = bag?.customModels;
  if (!Array.isArray(list)) return [];
  return list as ProviderCustomModel[];
}

function writeCustomModels(
  configs: ProviderConfigMap,
  providerId: ProviderId,
  rows: ProviderCustomModel[],
): void {
  const bag = configs[providerId] ?? {};
  configs[providerId] = { ...bag, customModels: rows };
}

function containsModelIdCaseInsensitive(
  rows: ProviderCustomModel[],
  candidate: string,
): boolean {
  const target = candidate.toLowerCase();
  for (const row of rows) {
    if (typeof row.id === 'string' && row.id.toLowerCase() === target) {
      return true;
    }
  }
  return false;
}

function resolveOwningProvider(
  modelId: string,
  settings: ClaudianSettings,
): ProviderId | null {
  for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    if (uiConfig.ownsModel(modelId, asSettingsBag(settings))) {
      return providerId;
    }
  }
  return null;
}
