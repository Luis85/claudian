import {
  type EnvHashReconcilerSpec,
  reconcileEnvironmentHash,
} from '../../../core/providers/EnvHashReconciler';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import { resolveCodexModelSelection } from '../modelOptions';
import { getCodexProviderSettings, updateCodexProviderSettings } from '../settings';
import { getCodexState } from '../types';
import { codexChatUIConfig } from '../ui/CodexChatUIConfig';

const ENV_HASH_KEYS = ['OPENAI_MODEL', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'];

const codexEnvHashSpec: EnvHashReconcilerSpec = {
  providerId: 'codex',
  watchedKeys: ENV_HASH_KEYS,
  getSavedHash: settings => getCodexProviderSettings(settings).environmentHash,
  saveHash: (settings, hash) => updateCodexProviderSettings(settings, { environmentHash: hash }),
  invalidateConversation: conversation => {
    const state = getCodexState(conversation.providerState);
    if (conversation.providerId !== 'codex' || !(conversation.sessionId || state.threadId)) {
      return false;
    }
    conversation.sessionId = null;
    conversation.providerState = undefined;
    return true;
  },
  reconcileModel: settings => {
    const currentModel = typeof settings.model === 'string' ? settings.model : '';
    const nextModel = resolveCodexModelSelection(settings, currentModel);
    if (nextModel) {
      settings.model = nextModel;
    }
  },
};

export const codexSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment: (settings, conversations, resolveEnvText) =>
    reconcileEnvironmentHash(codexEnvHashSpec, settings, conversations, resolveEnvText),

  setEnabled(settings, enabled) {
    updateCodexProviderSettings(settings, { enabled });
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const model = settings.model as string;
    if (!model) {
      return false;
    }

    const normalizedModel = codexChatUIConfig.normalizeModelVariant(model, settings);
    if (normalizedModel === model) {
      return false;
    }

    settings.model = normalizedModel;
    return true;
  },
};
