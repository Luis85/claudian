import { Setting } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { widgetContextFromTabRenderer } from '../../../core/providers/settingsWidgets';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import { t } from '../../../i18n/i18n';
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

    new Setting(container)
      .setName(t('settings.customModels.name'))
      .setDesc(t('settings.customModels.desc'))
      .addTextArea((text) => {
        // Dead code path (J1 cleanup pending): the textarea still operates on a
        // newline-delimited string, while the persisted shape is now ProviderCustomModel[].
        // Coerce between the two so the legacy UI keeps compiling and roundtripping ids.
        const serialize = (rows: { id: string }[]): string => rows.map(row => row.id).join('\n');
        let pendingCustomModels = serialize(claudeSettings.customModels);
        let savedCustomModels = pendingCustomModels;

        const commitCustomModels = async (): Promise<void> => {
          const previousCustomModels = savedCustomModels;
          const previousModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
          const previousTitleModel = typeof settingsBag.titleGenerationModel === 'string'
            ? settingsBag.titleGenerationModel
            : '';

          if (pendingCustomModels !== savedCustomModels) {
            updateClaudeProviderSettings(settingsBag, {
              customModels: pendingCustomModels
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((id, index, list) => id.length > 0 && list.indexOf(id) === index)
                .map((id) => ({ id, source: 'user' as const })),
            });
            savedCustomModels = pendingCustomModels;
          }

          reconcileActiveClaudeModelSelection();
          const didReconcileTitleModel = ProviderSettingsCoordinator
            .reconcileTitleGenerationModelSelection(settingsBag);
          const nextModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
          const nextTitleModel = typeof settingsBag.titleGenerationModel === 'string'
            ? settingsBag.titleGenerationModel
            : '';
          const didModelSelectionChange = previousModel !== nextModel;
          const didCustomModelsChange = previousCustomModels !== savedCustomModels;

          if (!didCustomModelsChange && !didModelSelectionChange && !didReconcileTitleModel
            && previousTitleModel === nextTitleModel) {
            return;
          }

          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        };

        text
          .setPlaceholder(t('settings.customModels.placeholder'))
          .setValue(serialize(claudeSettings.customModels))
          .onChange((value) => {
            pendingCustomModels = value;
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 40;
        text.inputEl.addEventListener('blur', () => {
          void commitCustomModels();
        });
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
