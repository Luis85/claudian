import {
  type EnvHashReconcilerSpec,
  reconcileEnvironmentHash,
} from '../../../core/providers/EnvHashReconciler';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import { clearOpencodeDiscoveryState } from '../discoveryState';
import { sameStringList, sameStringMap } from '../internal/compareCollections';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
import {
  decodeOpencodeModelId,
  encodeOpencodeModelId,
  extractOpencodeModelVariantValue,
  isOpencodeModelSelectionId,
  OPENCODE_DEFAULT_THINKING_LEVEL,
  resolveOpencodeBaseModelRawId,
} from '../models';
import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from '../modes';
import {
  getOpencodeProviderSettings,
  hasLegacyOpencodeDiscoveryFields,
  normalizeOpencodePreferredThinkingByModel,
  normalizeOpencodeVisibleModels,
  updateOpencodeProviderSettings,
} from '../settings';
import { getOpencodeState } from '../types';

interface NormalizedSelection {
  baseModelId: string | null;
  variant: string | null;
}

type OpencodeDiscoveredModels = ReturnType<typeof getOpencodeProviderSettings>['discoveredModels'];

function normalizeModelSelection(
  value: unknown,
  discoveredModels: OpencodeDiscoveredModels,
): NormalizedSelection {
  if (typeof value !== 'string' || !isOpencodeModelSelectionId(value)) {
    return { baseModelId: null, variant: null };
  }

  const rawModelId = decodeOpencodeModelId(value);
  if (!rawModelId) {
    return { baseModelId: value, variant: null };
  }

  const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, discoveredModels);
  return {
    baseModelId: encodeOpencodeModelId(baseRawId),
    variant: extractOpencodeModelVariantValue(rawModelId, discoveredModels),
  };
}

// Collapse a model-selection id stored on a settings key down to its base model id,
// mirroring the legacy variant migration. Returns true when the key was rewritten.
function normalizeModelKey(
  bag: Record<string, unknown>,
  key: string,
  discoveredModels: OpencodeDiscoveredModels,
): boolean {
  const value = bag[key];
  if (typeof value !== 'string') {
    return false;
  }
  const { baseModelId } = normalizeModelSelection(value, discoveredModels);
  if (!baseModelId || value === baseModelId) {
    return false;
  }
  bag[key] = baseModelId;
  return true;
}

function normalizeTopLevelModel(
  settings: Record<string, unknown>,
  discoveredModels: OpencodeDiscoveredModels,
): boolean {
  // Resolve the variant from the original model id before the key is rewritten to its base id.
  const { variant } = normalizeModelSelection(settings.model, discoveredModels);
  let changed = normalizeModelKey(settings, 'model', discoveredModels);

  if (variant && (typeof settings.effortLevel !== 'string' || settings.effortLevel.trim().length === 0)) {
    settings.effortLevel = variant;
    changed = true;
  }

  return changed;
}

function normalizeSavedProviderModel(
  settings: Record<string, unknown>,
  discoveredModels: OpencodeDiscoveredModels,
): boolean {
  const savedProviderModelRaw = settings.savedProviderModel;
  if (!savedProviderModelRaw || typeof savedProviderModelRaw !== 'object' || Array.isArray(savedProviderModelRaw)) {
    return false;
  }

  const savedProviderModel = savedProviderModelRaw as Record<string, unknown>;
  const savedSelection = normalizeModelSelection(savedProviderModel.opencode, discoveredModels);
  let changed = normalizeModelKey(savedProviderModel, 'opencode', discoveredModels);

  if (savedSelection.variant) {
    const savedEffort = ensureProviderProjectionMap(settings, 'savedProviderEffort');
    if (typeof savedEffort.opencode !== 'string') {
      savedEffort.opencode = savedSelection.variant;
      changed = true;
    }
  }

  return changed;
}

const OPENCODE_ENV_HASH_KEYS = [
  'OPENCODE_CONFIG',
  'OPENCODE_DB',
  'OPENCODE_DISABLE_PROJECT_CONFIG',
  'XDG_DATA_HOME',
] as const;

const opencodeEnvHashSpec: EnvHashReconcilerSpec = {
  providerId: 'opencode',
  watchedKeys: OPENCODE_ENV_HASH_KEYS,
  getSavedHash: settings => getOpencodeProviderSettings(settings).environmentHash,
  saveHash: (settings, hash) => updateOpencodeProviderSettings(settings, { environmentHash: hash }),
  invalidateConversation: conversation => {
    if (conversation.providerId !== 'opencode') {
      return false;
    }
    const state = getOpencodeState(conversation.providerState);
    if (!conversation.sessionId && !state.databasePath) {
      return false;
    }
    conversation.sessionId = null;
    conversation.providerState = undefined;
    return true;
  },
};

export const opencodeSettingsReconciler: ProviderSettingsReconciler = {
  setEnabled(settings, enabled) {
    updateOpencodeProviderSettings(settings, { enabled });
  },

  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return clearOpencodeDiscoveryState(settings);
  },

  normalizeOnLoad(settings: Record<string, unknown>): boolean {
    const configs = settings.providerConfigs;
    if (!configs || typeof configs !== 'object' || Array.isArray(configs)) {
      return false;
    }
    const opencodeConfig = (configs as Record<string, unknown>).opencode;
    if (!opencodeConfig || typeof opencodeConfig !== 'object' || Array.isArray(opencodeConfig)) {
      return false;
    }
    const bag = opencodeConfig as { selectedMode?: unknown };
    if (bag.selectedMode === OPENCODE_PLAN_MODE_ID) {
      bag.selectedMode = OPENCODE_SAFE_MODE_ID;
      return true;
    }
    return false;
  },

  reconcileModelWithEnvironment: (settings, conversations, resolveEnvText) =>
    reconcileEnvironmentHash(opencodeEnvHashSpec, settings, conversations, resolveEnvText),

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const hadLegacyDiscoveryFields = hasLegacyOpencodeDiscoveryFields(settings);
    if (hadLegacyDiscoveryFields) {
      updateOpencodeProviderSettings(settings, {});
    }

    const opencodeSettings = getOpencodeProviderSettings(settings);
    const { discoveredModels } = opencodeSettings;
    let changed = hadLegacyDiscoveryFields;

    if (normalizeTopLevelModel(settings, discoveredModels)) {
      changed = true;
    }
    if (normalizeModelKey(settings, 'titleGenerationModel', discoveredModels)) {
      changed = true;
    }
    if (normalizeSavedProviderModel(settings, discoveredModels)) {
      changed = true;
    }

    const normalizedVisibleModels = normalizeOpencodeVisibleModels(
      opencodeSettings.visibleModels,
      opencodeSettings.discoveredModels,
    );
    const normalizedPreferredThinking = normalizeOpencodePreferredThinkingByModel(
      opencodeSettings.preferredThinkingByModel,
      opencodeSettings.discoveredModels,
    );
    const shouldUpdateProviderSettings = !sameStringList(normalizedVisibleModels, opencodeSettings.visibleModels)
      || !sameStringMap(normalizedPreferredThinking, opencodeSettings.preferredThinkingByModel);
    if (shouldUpdateProviderSettings) {
      updateOpencodeProviderSettings(settings, {
        preferredThinkingByModel: normalizedPreferredThinking,
        visibleModels: normalizedVisibleModels,
      });
      changed = true;
    }

    if (typeof settings.effortLevel === 'string' && !settings.effortLevel.trim()) {
      settings.effortLevel = OPENCODE_DEFAULT_THINKING_LEVEL;
      changed = true;
    }

    return changed;
  },
};
