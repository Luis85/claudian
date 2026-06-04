import {
  type EnvHashReconcilerSpec,
  reconcileEnvironmentHash,
} from '../../../core/providers/EnvHashReconciler';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getCachedCursorModelIds } from '../runtime/cursorModelCatalog';
import {
  CURSOR_STANDARD_MODE,
  extractCursorModeValue,
  resolveCursorFamilyId,
} from '../runtime/cursorModelFamily';
import { fromCursorModelValue, isCursorModelValue, toCursorModelValue } from '../runtime/cursorModelId';
import {
  getCursorProviderSettings,
  updateCursorProviderSettings,
} from '../settings';
import { getCursorState } from '../types';
import { cursorChatUIConfig } from '../ui/CursorChatUIConfig';

const ENV_HASH_KEYS = ['CURSOR_API_KEY', 'CURSOR_BASE_URL'];

// Splits a full-variant raw id into family + mode and writes the collapsed
// family value back to `settings.model`, seeding the per-family mode preference
// and the shared effortLevel. Returns true when anything changed.
function collapseModelSelection(settings: Record<string, unknown>): boolean {
  const model = settings.model;
  if (typeof model !== 'string' || !isCursorModelValue(model)) {
    return false;
  }
  const rawId = fromCursorModelValue(model);
  const cachedIds = getCachedCursorModelIds();
  const familyId = resolveCursorFamilyId(rawId, cachedIds);
  if (familyId === rawId) {
    return false;
  }

  const mode = extractCursorModeValue(rawId, cachedIds);
  settings.model = toCursorModelValue(familyId);
  if (mode) {
    settings.effortLevel = mode;
    const current = getCursorProviderSettings(settings).preferredModeByFamily;
    if (current[familyId] !== mode) {
      updateCursorProviderSettings(settings, {
        preferredModeByFamily: { ...current, [familyId]: mode },
      });
    }
  } else {
    settings.effortLevel = CURSOR_STANDARD_MODE;
  }
  return true;
}

const cursorEnvHashSpec: EnvHashReconcilerSpec = {
  providerId: 'cursor',
  watchedKeys: ENV_HASH_KEYS,
  getSavedHash: settings => getCursorProviderSettings(settings).environmentHash,
  saveHash: (settings, hash) => updateCursorProviderSettings(settings, { environmentHash: hash }),
  invalidateConversation: conversation => {
    const state = getCursorState(conversation.providerState);
    if (conversation.providerId !== 'cursor' || !(conversation.sessionId || state.chatSessionId)) {
      return false;
    }
    conversation.sessionId = null;
    conversation.providerState = undefined;
    return true;
  },
  reconcileModel: (settings, envText) => {
    const envVars = parseEnvironmentVariables(envText || '');
    if (envVars.CURSOR_MODEL) {
      settings.model = toCursorModelValue(envVars.CURSOR_MODEL);
      collapseModelSelection(settings);
    } else if (typeof settings.model === 'string' && settings.model.length > 0) {
      collapseModelSelection(settings);
      const options = cursorChatUIConfig.getModelOptions(settings);
      const isValid = options.some(option => option.value === settings.model);
      if (!isValid) {
        settings.model = options[0]?.value ?? toCursorModelValue('auto');
      }
    }
  },
};

export const cursorSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment: (settings, conversations, resolveEnvText) =>
    reconcileEnvironmentHash(cursorEnvHashSpec, settings, conversations, resolveEnvText),

  setEnabled(settings, enabled) {
    updateCursorProviderSettings(settings, { enabled });
  },

  normalizeModelVariantSettings(settings): boolean {
    return collapseModelSelection(settings);
  },
};
