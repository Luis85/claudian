import type { DropdownComponent } from 'obsidian';
import { Setting } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';

export function renderAgentBoardSettingsSection(
  container: HTMLElement,
  plugin: ClaudianPlugin,
): void {
  new Setting(container)
    .setName('Work order folder')
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    .setDesc('Folder where new Agent Board work orders are created.')
    .addText((text) =>
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- folder path, not prose.
        .setPlaceholder('Agent Board/tasks')
        .setValue(plugin.settings.agentBoardWorkOrderFolder)
        .onChange(async (value) => {
          plugin.settings.agentBoardWorkOrderFolder = value.trim();
          await plugin.saveSettings();
        }),
    );

  const settings = plugin.settings as unknown as Record<string, unknown>;

  let modelDropdown: DropdownComponent | null = null;

  const populateModels = (providerId: string): void => {
    if (!modelDropdown) return;
    modelDropdown.selectEl.empty();
    modelDropdown.addOption('', 'Provider default');
    const options = ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings);
    for (const option of options) {
      modelDropdown.addOption(option.value, option.label);
    }
    const current = plugin.settings.agentBoardDefaultModel;
    modelDropdown.setValue(options.some((option) => option.value === current) ? current : '');
  };

  new Setting(container)
    .setName('Default provider')
    .setDesc('Provider used to run new work orders.')
    .addDropdown((dropdown) => {
      const enabled = ProviderRegistry.getEnabledProviderIds(settings);
      for (const providerId of enabled) {
        dropdown.addOption(providerId, providerId);
      }
      const current = plugin.settings.agentBoardDefaultProvider;
      const selected = enabled.includes(current as ProviderId) ? current : (enabled[0] ?? '');
      dropdown.setValue(selected);
      dropdown.onChange(async (value) => {
        plugin.settings.agentBoardDefaultProvider = value;
        plugin.settings.agentBoardDefaultModel = '';
        await plugin.saveSettings();
        populateModels(value);
      });
    });

  new Setting(container)
    .setName('Default model')
    .setDesc('Model used to run new work orders.')
    .addDropdown((dropdown) => {
      modelDropdown = dropdown;
      populateModels(plugin.settings.agentBoardDefaultProvider);
      dropdown.onChange(async (value) => {
        plugin.settings.agentBoardDefaultModel = value;
        await plugin.saveSettings();
      });
    });
}
