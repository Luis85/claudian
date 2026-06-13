import { Setting } from 'obsidian';

import { widgetContextFromTabRenderer } from '../../../core/providers/settingsWidgets';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { mountCustomModelsSetting } from '../../../shared/settings/customModelsSetting';
import { getCodexWorkspaceServices } from '../app/codexWorkspaceAccess';
import { resolveCodexModelSelection } from '../modelOptions';
import { getCodexProviderSettings, updateCodexProviderSettings } from '../settings';
import {
  codexSettingsWidgets,
  mountCodexCliPathSetting,
  mountCodexEnvironmentSection,
  mountCodexHiddenSkillsSetting,
  mountCodexInstallationMethodSetting,
  mountCodexMcpNotice,
  mountCodexSkillsSection,
  mountCodexSubagentsSection,
  mountCodexWslDistroOverrideSetting,
} from './codexSettingsWidgets';

export const codexSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = asSettingsBag(context.plugin.settings);
    const codexSettings = getCodexProviderSettings(settingsBag);
    const isWindowsHost = process.platform === 'win32';
    const widgetCtx = widgetContextFromTabRenderer(context, () => {
      container.empty();
      codexSettingsTabRenderer.render(container, context);
    });

    const reconcileActiveCodexModelSelection = (): void => {
      const activeProvider = settingsBag.settingsProvider;
      if (activeProvider !== 'codex') {
        return;
      }

      const currentModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
      const nextModel = resolveCodexModelSelection(settingsBag, currentModel);
      if (!nextModel || nextModel === currentModel) {
        return;
      }

      settingsBag.model = nextModel;
    };

    const reconcileInactiveCodexProjection = (
      previousCustomModels: string,
    ): boolean => {
      if (settingsBag.settingsProvider === 'codex') {
        return false;
      }

      const savedProviderModel = (
        settingsBag.savedProviderModel
        && typeof settingsBag.savedProviderModel === 'object'
      )
        ? settingsBag.savedProviderModel as Record<string, unknown>
        : {};
      const currentSavedModel = typeof savedProviderModel.codex === 'string'
        ? savedProviderModel.codex
        : '';
      if (!currentSavedModel) {
        return false;
      }

      const previousCustomModelIds = new Set(
        previousCustomModels
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
      if (!previousCustomModelIds.has(currentSavedModel)) {
        return false;
      }

      const nextSavedModel = resolveCodexModelSelection(settingsBag, currentSavedModel);
      if (!nextSavedModel || nextSavedModel === currentSavedModel) {
        return false;
      }

      settingsBag.savedProviderModel = {
        ...savedProviderModel,
        codex: nextSavedModel,
      };
      return true;
    };

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Enable Codex provider')
      .setDesc('When enabled, Codex models appear in the model selector for new conversations. Existing Codex sessions are preserved.')
      .addToggle((toggle) =>
        toggle
          .setValue(codexSettings.enabled)
          .onChange(async (value) => {
            updateCodexProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    if (isWindowsHost) {
      mountCodexInstallationMethodSetting(container, widgetCtx);
    }

    mountCodexCliPathSetting(container, widgetCtx);

    if (isWindowsHost) {
      mountCodexWslDistroOverrideSetting(container, widgetCtx);
    }

    // --- Safety ---

    new Setting(container).setName(t('settings.safety')).setHeading();

    new Setting(container)
      .setName(t('settings.codexSafeMode.name'))
      .setDesc(t('settings.codexSafeMode.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('workspace-write', 'Workspace write')
          .addOption('read-only', 'Read only')
          .setValue(codexSettings.safeMode)
          .onChange(async (value) => {
            updateCodexProviderSettings(
              settingsBag,
              { safeMode: value as 'workspace-write' | 'read-only' },
            );
            await context.plugin.saveSettings();
          });
      });

    // --- Models ---

    new Setting(container).setName(t('settings.models')).setHeading();

    const SUMMARY_OPTIONS: { value: string; label: string }[] = [
      { value: 'auto', label: 'Auto' },
      { value: 'concise', label: 'Concise' },
      { value: 'detailed', label: 'Detailed' },
      { value: 'none', label: 'Off' },
    ];

    mountCustomModelsSetting(container, {
      name: 'Custom models',
      desc: 'Append additional Codex model ids to the picker, one per line. `OPENAI_MODEL` still takes precedence when set.',
      placeholder: 'gpt-5.4\ngpt-5.3-codex-spark',
      rows: 4,
      settingsBag,
      currentModels: codexSettings.customModels,
      applyCustomModels: (models) =>
        updateCodexProviderSettings(settingsBag, { customModels: models }),
      reconcileActiveModelSelection: reconcileActiveCodexModelSelection,
      reconcileInactiveProjection: reconcileInactiveCodexProjection,
      saveSettings: () => context.plugin.saveSettings(),
      refreshModelSelectors: () => context.refreshModelSelectors(),
    });

    new Setting(container)
      .setName('Reasoning summary')
      .setDesc('Show a summary of the model\'s reasoning process in the thinking block.')
      .addDropdown((dropdown) => {
        for (const opt of SUMMARY_OPTIONS) {
          dropdown.addOption(opt.value, opt.label);
        }
        dropdown.setValue(codexSettings.reasoningSummary);
        dropdown.onChange(async (value) => {
          updateCodexProviderSettings(
            settingsBag,
            { reasoningSummary: value as 'auto' | 'concise' | 'detailed' | 'none' },
          );
          await context.plugin.saveSettings();
        });
      });

    // --- Skills ---

    if (getCodexWorkspaceServices().commandCatalog) {
      new Setting(container).setName('Codex skills').setHeading();
      mountCodexSkillsSection(container, widgetCtx);
    }

    mountCodexHiddenSkillsSetting(container, widgetCtx);

    // --- Subagents ---

    new Setting(container).setName('Codex subagents').setHeading();

    mountCodexSubagentsSection(container, widgetCtx);

    // --- MCP Servers ---

    new Setting(container).setName(t('settings.mcpServers.name')).setHeading();

    mountCodexMcpNotice(container, widgetCtx);

    // --- Environment ---

    mountCodexEnvironmentSection(container, widgetCtx, t('settings.environment'));
  },
  widgets: codexSettingsWidgets,
};
