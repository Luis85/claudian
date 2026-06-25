import { Notice,type TAbstractFile } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderId } from '@/core/providers/types';
import { asSettingsBag } from '@/core/types/settings';
import { resolveBlankTabModel } from '@/features/chat/tabs/tabShared';
import { t } from '@/i18n/i18n';
import type SpecoratorPlugin from '@/main';

import { quickActionStemFromPath } from './quickActionStem';
import { runQuickActionForFile } from './runQuickActionForFile';
import type { QuickAction } from './types';
import {
  QuickActionLaunchModal,
  type QuickActionLaunchProvider,
} from './ui/QuickActionLaunchModal';

/**
 * Single seam invoked by every non-chat quick-action entry point.
 *
 * Resolves the preset (stored last-used or global default), validates it
 * against currently enabled providers and their model catalog, opens the
 * launch modal, persists the confirmed choice, and delegates to
 * `runQuickActionForFile` with a provider+model override.
 */
export async function launchQuickAction(
  plugin: SpecoratorPlugin,
  file: TAbstractFile,
  action: QuickAction,
): Promise<void> {
  const stem = quickActionStemFromPath(action.filePath);
  const settings = asSettingsBag(plugin.settings);

  const enabledProviders = buildEnabledProviders(settings);
  const enabledIds = new Set(enabledProviders.map((p) => p.id));

  const stored = plugin.quickActionLastUsedStore?.get(stem) ?? null;
  let presetProviderId: ProviderId;
  let presetModel: string;
  let fallbackNotice: { storedProviderLabel: string; storedModelLabel: string } | undefined;

  const storedIsValid = !!stored
    && enabledIds.has(stored.providerId)
    && !!enabledProviders.find((p) => p.id === stored.providerId)
      ?.models.some((m) => m.value === stored.model);

  if (stored && storedIsValid) {
    presetProviderId = stored.providerId;
    presetModel = stored.model;
  } else {
    presetProviderId = ProviderRegistry.resolveSettingsProviderId(settings);
    presetModel = resolveBlankTabModel(plugin, presetProviderId);
    if (stored) {
      fallbackNotice = {
        storedProviderLabel: resolveProviderLabel(stored.providerId),
        storedModelLabel: resolveModelLabel(stored.providerId, stored.model, settings),
      };
      plugin.quickActionLastUsedStore?.delete(stem);
    }
  }

  const modal = new QuickActionLaunchModal({
    app: plugin.app,
    action,
    presetProviderId,
    presetModel,
    enabledProviders,
    resolveDefaultModelForProvider: (providerId) => resolveBlankTabModel(plugin, providerId),
    fallbackNotice,
    onConfirm: (choice) => {
      // Re-check that the chosen provider is still enabled. The modal may
      // have been open while settings were edited in another window.
      if (!ProviderRegistry.isEnabled(choice.providerId, settings)) {
        new Notice(t('quickActions.launchModal.providerDisabled'));
        return;
      }
      plugin.quickActionLastUsedStore?.set(stem, choice);
      void runQuickActionForFile(plugin, file, action, choice);
    },
  });
  modal.open();
}

function buildEnabledProviders(settings: Record<string, unknown>): QuickActionLaunchProvider[] {
  const out: QuickActionLaunchProvider[] = [];
  for (const id of ProviderRegistry.getRegisteredProviderIds()) {
    if (!ProviderRegistry.isEnabled(id, settings)) continue;
    const uiConfig = ProviderRegistry.getChatUIConfig(id);
    const models = uiConfig.getModelOptions(settings).map((opt) => ({
      value: opt.value,
      label: opt.label,
    }));
    out.push({
      id,
      displayName: ProviderRegistry.getProviderDisplayName(id),
      models,
    });
  }
  return out;
}

function resolveProviderLabel(providerId: ProviderId): string {
  try {
    return ProviderRegistry.getProviderDisplayName(providerId);
  } catch {
    // Stored provider may no longer be registered; fall back to the raw id.
    return providerId;
  }
}

function resolveModelLabel(
  providerId: ProviderId,
  model: string,
  settings: Record<string, unknown>,
): string {
  try {
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const found = uiConfig.getModelOptions(settings).find((o) => o.value === model);
    if (found) return found.label;
  } catch {
    // Stored provider may no longer be registered; fall through to raw model id.
  }
  return model;
}
