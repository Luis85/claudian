import { Setting } from 'obsidian';

import {
  getOrchestratorSystemPromptForSettings,
  persistOrchestratorSystemPromptFromSettings,
} from '../../../core/prompt/orchestratorMode';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';

export function renderOrchestratorSettingsTab(
  container: HTMLElement,
  plugin: ClaudianPlugin,
): void {
  new Setting(container)
    .setName(t('settings.orchestrator.enabled.name'))
    .setDesc(t('settings.orchestrator.enabled.desc'))
    .addToggle((toggle) => {
      toggle
        .setValue(plugin.settings.orchestratorEnabled !== false)
        .onChange(async (value) => {
          plugin.settings.orchestratorEnabled = value;
          await plugin.saveSettings();
          for (const view of plugin.getAllViews()) {
            view.refreshModelSelector();
          }
        });
    });

  const promptSetting = new Setting(container)
    .setName(t('settings.orchestrator.systemPrompt.name'))
    .setDesc(t('settings.orchestrator.systemPrompt.desc'))
    .addTextArea((area) => {
      area
        .setValue(getOrchestratorSystemPromptForSettings(plugin.settings.orchestratorSystemPrompt))
        .onChange(async (value) => {
          plugin.settings.orchestratorSystemPrompt = persistOrchestratorSystemPromptFromSettings(value);
          await plugin.saveSettings();
        });
      area.inputEl.rows = 14;
      area.inputEl.addClass('claudian-orchestrator-prompt-textarea');
    });
  promptSetting.settingEl.addClass('claudian-orchestrator-prompt-setting');
}
