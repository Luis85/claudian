import { Setting } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { widgetContextFromTabRenderer } from '../../../core/providers/settingsWidgets';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import { t } from '../../../i18n/i18n';
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

    new Setting(container)
      .setName('Custom models')
      .setDesc('Append additional Codex model ids to the picker, one per line. `OPENAI_MODEL` still takes precedence when set.')
      .addTextArea((text) => {
        // Dead code path (J1 cleanup pending): the textarea still operates on a
        // newline-delimited string, while the persisted shape is now ProviderCustomModel[].
        // Coerce between the two so the legacy UI keeps compiling and roundtripping ids.
        const serialize = (rows: { id: string }[]): string => rows.map(row => row.id).join('\n');
        let pendingCustomModels = serialize(codexSettings.customModels);
        let savedCustomModels = pendingCustomModels;

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

        const commitCustomModels = async (): Promise<void> => {
          const previousCustomModels = savedCustomModels;
          const previousModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
          const previousTitleModel = typeof settingsBag.titleGenerationModel === 'string'
            ? settingsBag.titleGenerationModel
            : '';

          if (pendingCustomModels !== savedCustomModels) {
            updateCodexProviderSettings(settingsBag, {
              customModels: pendingCustomModels
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((id, index, list) => id.length > 0 && list.indexOf(id) === index)
                .map((id) => ({ id, source: 'user' as const })),
            });
            savedCustomModels = pendingCustomModels;
          }

          reconcileActiveCodexModelSelection();
          const didReconcileInactiveProjection = reconcileInactiveCodexProjection(previousCustomModels);
          const didReconcileTitleModel = ProviderSettingsCoordinator
            .reconcileTitleGenerationModelSelection(settingsBag);
          const nextModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
          const nextTitleModel = typeof settingsBag.titleGenerationModel === 'string'
            ? settingsBag.titleGenerationModel
            : '';
          const didModelSelectionChange = previousModel !== nextModel;
          const didCustomModelsChange = previousCustomModels !== savedCustomModels;

          if (!didCustomModelsChange && !didModelSelectionChange && !didReconcileInactiveProjection
            && !didReconcileTitleModel
            && previousTitleModel === nextTitleModel) {
            return;
          }

          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        };

        text
          .setPlaceholder('gpt-5.4\ngpt-5.3-codex-spark')
          .setValue(serialize(codexSettings.customModels))
          .onChange((value) => {
            pendingCustomModels = value;
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
        text.inputEl.addEventListener('blur', () => {
          void commitCustomModels();
        });
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
