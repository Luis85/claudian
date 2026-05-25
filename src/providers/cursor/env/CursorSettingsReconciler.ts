import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { toCursorModelValue } from '../runtime/cursorModelId';
import { getCursorProviderSettings, updateCursorProviderSettings } from '../settings';
import { getCursorState } from '../types';
import { cursorChatUIConfig } from '../ui/CursorChatUIConfig';

const ENV_HASH_KEYS = ['CURSOR_API_KEY', 'CURSOR_BASE_URL'];

function computeCursorEnvHash(envText: string): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return ENV_HASH_KEYS
    .filter(key => envVars[key])
    .map(key => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

export const cursorSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'cursor');
    const currentHash = computeCursorEnvHash(envText);
    const savedHash = getCursorProviderSettings(settings).environmentHash;

    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conv of conversations) {
      const state = getCursorState(conv.providerState);
      if (conv.providerId === 'cursor' && (conv.sessionId || state.chatSessionId)) {
        conv.sessionId = null;
        conv.providerState = undefined;
        invalidatedConversations.push(conv);
      }
    }

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

    updateCursorProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(): boolean {
    return false;
  },
};
