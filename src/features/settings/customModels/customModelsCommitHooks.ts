import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderId } from '../../../core/providers/types';
import type { SettingsCtx } from '../registry/SettingsField';
import type { CustomModelsCommitHooks } from './CustomModelsTable';

/**
 * Mirrors the legacy provider tabs' custom-model commit order: write rows →
 * reconcile the active and title-generation model selections against the new
 * list → save once → refresh open chat model selectors. Without this,
 * deleting the currently selected custom model leaves `settings.model`
 * pointing at a removed option until a later reload (Codex review on PR #82).
 */
export function customModelsCommitHooks(
  ctx: SettingsCtx,
  providerId: ProviderId,
): CustomModelsCommitHooks {
  return {
    beforeSave: () => {
      const settings = ctx.settings as unknown as Record<string, unknown>;
      // Legacy guard: only repoint the active model when this provider owns
      // the current settings selection (or no provider is pinned yet).
      const activeProvider = settings.settingsProvider;
      if (activeProvider === undefined || activeProvider === providerId) {
        ProviderRegistry.getChatUIConfig(providerId).reconcileModelSelection?.(settings);
      }
      ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings);
    },
    afterSave: () => {
      for (const view of ctx.plugin.getAllViews()) {
        view.refreshModelSelector();
      }
    },
  };
}
