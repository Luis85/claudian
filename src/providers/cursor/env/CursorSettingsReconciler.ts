import {
  type EnvHashReconcilerSpec,
  reconcileEnvironmentHash,
} from '../../../core/providers/EnvHashReconciler';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { toCursorModelValue } from '../runtime/cursorModelId';
import { getCursorProviderSettings, updateCursorProviderSettings } from '../settings';
import { getCursorState } from '../types';
import { cursorChatUIConfig } from '../ui/CursorChatUIConfig';

const ENV_HASH_KEYS = ['CURSOR_API_KEY', 'CURSOR_BASE_URL'];

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
      // Persist the namespaced value so routing stays unambiguous.
      settings.model = toCursorModelValue(envVars.CURSOR_MODEL);
    } else if (typeof settings.model === 'string' && settings.model.length > 0) {
      // Only reset when the current selection is not a valid current option;
      // a still-valid selection is preserved.
      const options = cursorChatUIConfig.getModelOptions(settings);
      const isValid = options.some(option => option.value === settings.model);
      if (!isValid) {
        settings.model = options[0]?.value ?? toCursorModelValue('auto');
      }
    }
  },
};

export const cursorSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment: (settings, conversations) =>
    reconcileEnvironmentHash(cursorEnvHashSpec, settings, conversations),

  normalizeModelVariantSettings(): boolean {
    return false;
  },
};
