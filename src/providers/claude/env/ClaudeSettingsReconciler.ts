import {
  type EnvHashReconcilerSpec,
  reconcileEnvironmentHash,
} from '../../../core/providers/EnvHashReconciler';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import { resolveClaudeModelSelection } from '../modelOptions';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '../settings';
import { normalizeVisibleModelVariant } from '../types/models';

const ENV_HASH_MODEL_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
];
const ENV_HASH_PROVIDER_KEYS = ['ANTHROPIC_BASE_URL'];

const claudeEnvHashSpec: EnvHashReconcilerSpec = {
  providerId: 'claude',
  watchedKeys: [...ENV_HASH_MODEL_KEYS, ...ENV_HASH_PROVIDER_KEYS],
  getSavedHash: settings => getClaudeProviderSettings(settings).environmentHash,
  saveHash: (settings, hash) => updateClaudeProviderSettings(settings, { environmentHash: hash }),
  invalidateConversation: conversation => {
    if (!conversation.sessionId) {
      return false;
    }
    conversation.sessionId = null;
    return true;
  },
  reconcileModel: settings => {
    const currentModel = typeof settings.model === 'string' ? settings.model : '';
    const nextModel = resolveClaudeModelSelection(settings, currentModel);
    if (nextModel) {
      settings.model = nextModel;
    }
  },
};

export const claudeSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment: (settings, conversations) =>
    reconcileEnvironmentHash(claudeEnvHashSpec, settings, conversations),

  setEnabled(settings, enabled) {
    updateClaudeProviderSettings(settings, { enabled });
  },

  persistLastModel(settings, model) {
    updateClaudeProviderSettings(settings, { lastModel: model });
  },

  persistEnvironmentHash(settings, hash) {
    updateClaudeProviderSettings(settings, { environmentHash: hash });
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const claudeSettings = getClaudeProviderSettings(settings);
    let changed = false;

    const normalize = (model: string): string =>
      normalizeVisibleModelVariant(
        model,
        claudeSettings.enableOpus1M,
        claudeSettings.enableSonnet1M,
      );

    const model = settings.model as string;
    const normalizedModel = normalize(model);
    if (model !== normalizedModel) {
      settings.model = normalizedModel;
      changed = true;
    }

    const titleModel = settings.titleGenerationModel as string;
    if (titleModel) {
      const normalizedTitleModel = normalize(titleModel);
      if (titleModel !== normalizedTitleModel) {
        settings.titleGenerationModel = normalizedTitleModel;
        changed = true;
      }
    }

    const lastClaudeModel = claudeSettings.lastModel;
    if (lastClaudeModel) {
      const normalizedLastClaudeModel = normalize(lastClaudeModel);
      if (lastClaudeModel !== normalizedLastClaudeModel) {
        updateClaudeProviderSettings(settings, { lastModel: normalizedLastClaudeModel });
        changed = true;
      }
    }

    return changed;
  },
};
