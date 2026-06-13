import { Setting } from 'obsidian';

import { widgetContextFromTabRenderer } from '../../../core/providers/settingsWidgets';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { mountCustomModelsSetting } from '../../../shared/settings/customModelsSetting';
import { resolveClaudeModelSelection } from '../modelOptions';
import {
  CLAUDE_SAFE_MODES,
  type ClaudeSafeMode,
  getClaudeProviderSettings,
  updateClaudeProviderSettings,
} from '../settings';
import { claudeChatUIConfig } from './ClaudeChatUIConfig';
import {
  claudeSettingsWidgets,
  mountClaudeBangBashToggle,
  mountClaudeCliPathSetting,
  mountClaudeEnvironmentSection,
  mountClaudeHiddenCommandsSetting,
  mountClaudeMcpSection,
  mountClaudeOpus1MToggle,
  mountClaudePluginsSection,
  mountClaudeSlashCommandsSection,
  mountClaudeSonnet1MToggle,
  mountClaudeSubagentsSection,
  mountClaudeTrustVaultSetting,
} from './claudeSettingsWidgets';

export const claudeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = asSettingsBag(context.plugin.settings);
    const claudeSettings = getClaudeProviderSettings(settingsBag);
    const widgetCtx = widgetContextFromTabRenderer(context, () => {
      container.empty();
      claudeSettingsTabRenderer.render(container, context);
    });

    const reconcileActiveClaudeModelSelection = (): void => {
      const activeProvider = settingsBag.settingsProvider;
      if (activeProvider !== undefined && activeProvider !== 'claude') {
        return;
      }

      const currentModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
      const nextModel = resolveClaudeModelSelection(settingsBag, currentModel);
      if (!nextModel || nextModel === currentModel) {
        return;
      }

      settingsBag.model = nextModel;
      claudeChatUIConfig.applyModelDefaults(nextModel, settingsBag);
    };

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    mountClaudeCliPathSetting(container, widgetCtx);

    // --- Safety ---

    new Setting(container).setName(t('settings.safety')).setHeading();

    new Setting(container)
      .setName(t('settings.claudeSafeMode.name'))
      .setDesc(t('settings.claudeSafeMode.desc'))
      .addDropdown((dropdown) => {
        for (const mode of CLAUDE_SAFE_MODES) {
          dropdown.addOption(mode, mode);
        }
        dropdown
          .setValue(claudeSettings.safeMode)
          .onChange(async (value) => {
            updateClaudeProviderSettings(
              settingsBag,
              { safeMode: value as ClaudeSafeMode },
            );
            await context.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName(t('settings.loadUserSettings.name'))
      .setDesc(t('settings.loadUserSettings.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.loadUserSettings)
          .onChange(async (value) => {
            updateClaudeProviderSettings(settingsBag, { loadUserSettings: value });
            await context.plugin.saveSettings();
          })
      );

    mountClaudeTrustVaultSetting(container, widgetCtx);

    // --- Models ---

    new Setting(container).setName(t('settings.models')).setHeading();

    mountClaudeOpus1MToggle(container, widgetCtx);
    mountClaudeSonnet1MToggle(container, widgetCtx);

    mountCustomModelsSetting(container, {
      name: t('settings.customModels.name'),
      desc: t('settings.customModels.desc'),
      placeholder: t('settings.customModels.placeholder'),
      rows: 6,
      settingsBag,
      currentModels: claudeSettings.customModels,
      applyCustomModels: (models) =>
        updateClaudeProviderSettings(settingsBag, { customModels: models }),
      reconcileActiveModelSelection: reconcileActiveClaudeModelSelection,
      saveSettings: () => context.plugin.saveSettings(),
      refreshModelSelectors: () => context.refreshModelSelectors(),
    });

    // --- Slash Commands ---

    new Setting(container).setName(t('settings.slashCommands.name')).setHeading();

    mountClaudeSlashCommandsSection(container, widgetCtx);
    mountClaudeHiddenCommandsSetting(container, widgetCtx);

    // --- Subagents ---

    new Setting(container).setName(t('settings.subagents.name')).setHeading();

    mountClaudeSubagentsSection(container, widgetCtx);

    // --- MCP Servers ---

    new Setting(container).setName(t('settings.mcpServers.name')).setHeading();

    mountClaudeMcpSection(container, widgetCtx);

    // --- Plugins ---

    new Setting(container).setName(t('settings.plugins.name')).setHeading();

    mountClaudePluginsSection(container, widgetCtx);

    // --- Environment ---

    mountClaudeEnvironmentSection(container, widgetCtx, t('settings.environment'));

    // --- Experimental ---

    new Setting(container).setName(t('settings.experimental')).setHeading();

    new Setting(container)
      .setName(t('settings.enableChrome.name'))
      .setDesc(t('settings.enableChrome.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.enableChrome)
          .onChange(async (value) => {
            updateClaudeProviderSettings(settingsBag, { enableChrome: value });
            await context.plugin.saveSettings();
          })
      );

    mountClaudeBangBashToggle(container, widgetCtx);
  },
  widgets: claudeSettingsWidgets,
};
