import type { DropdownComponent } from 'obsidian';
import { Setting } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { renderAgentBoardLaneEditor } from '../../tasks/ui/AgentBoardLaneEditor';

/**
 * Pick the provider the Agent Board should display and run. Keeps the stored choice when it is
 * still enabled; otherwise falls back to the first enabled provider so the provider dropdown and
 * the model dropdown never disagree about which provider is active.
 */
export function resolveAgentBoardProvider(enabled: ProviderId[], stored: string): ProviderId | '' {
  return enabled.includes(stored as ProviderId) ? (stored as ProviderId) : (enabled[0] ?? '');
}

export function renderAgentBoardSettingsSection(
  container: HTMLElement,
  plugin: ClaudianPlugin,
): void {
  const normalizeFolder = (value: string): string => (value || '').replace(/^\/+|\/+$/g, '');

  // eslint-disable-next-line prefer-const -- assigned after creation to render after template folder
  let folderWarning!: Setting;
  const refreshFolderWarning = (): void => {
    const same =
      normalizeFolder(plugin.settings.agentBoardTemplateFolder) ===
      normalizeFolder(plugin.settings.agentBoardWorkOrderFolder);
    folderWarning.setDesc(
      same
        ? 'Warning: the template folder matches the work order folder, so templates will appear as invalid notes on the board.'
        : '',
    );
    if (same) {
      folderWarning.settingEl.show();
    } else {
      folderWarning.settingEl.hide();
    }
  };

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
          plugin.events.emit('task:board-config-changed');
          refreshFolderWarning();
        }),
    );

  new Setting(container)
    .setName('Template folder')
    .setDesc('Folder where work-order templates live.')
    .addText((text) =>
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- folder path, not prose.
        .setPlaceholder('Agent Board/templates')
        .setValue(plugin.settings.agentBoardTemplateFolder)
        .onChange(async (value) => {
          plugin.settings.agentBoardTemplateFolder = value.trim();
          await plugin.saveSettings();
          refreshFolderWarning();
        }),
    );

  folderWarning = new Setting(container).setName('');
  refreshFolderWarning();

  new Setting(container)
    .setName('Archive folder')
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    .setDesc('Folder where archived Agent Board work orders are moved. Keep it outside the work order folder.')
    .addText((text) =>
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- folder path, not prose.
        .setPlaceholder('Agent Board/archive')
        .setValue(plugin.settings.agentBoardArchiveFolder)
        .onChange(async (value) => {
          plugin.settings.agentBoardArchiveFolder = value.trim();
          await plugin.saveSettings();
        }),
    );

  const settings = plugin.settings as unknown as Record<string, unknown>;

  let modelDropdown: DropdownComponent | null = null;

  const populateModels = (providerId: string): void => {
    if (!modelDropdown) return;
    modelDropdown.selectEl.empty();
    modelDropdown.addOption('', 'Provider default');
    const options = providerId
      ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
      : [];
    for (const option of options) {
      modelDropdown.addOption(option.value, option.label);
    }
    const current = plugin.settings.agentBoardDefaultModel;
    modelDropdown.setValue(options.some((option) => option.value === current) ? current : '');
  };

  // Resolve once so the provider dropdown, the persisted setting, and the model dropdown all agree.
  // Without this, a stored-but-disabled provider (e.g. the default codex when only cursor is
  // enabled) would be shown via setValue without persisting, so models populated for the stale
  // provider and never refreshed for the displayed one.
  const enabledProviders = ProviderRegistry.getEnabledProviderIds(settings);
  const selectedProvider = resolveAgentBoardProvider(
    enabledProviders,
    plugin.settings.agentBoardDefaultProvider,
  );
  if (selectedProvider && selectedProvider !== plugin.settings.agentBoardDefaultProvider) {
    plugin.settings.agentBoardDefaultProvider = selectedProvider;
    void plugin.saveSettings();
  }

  new Setting(container)
    .setName('Default provider')
    .setDesc('Provider used to run new work orders.')
    .addDropdown((dropdown) => {
      for (const providerId of enabledProviders) {
        dropdown.addOption(providerId, providerId);
      }
      dropdown.setValue(selectedProvider);
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
      populateModels(selectedProvider);
      dropdown.onChange(async (value) => {
        plugin.settings.agentBoardDefaultModel = value;
        await plugin.saveSettings();
      });
    });

  container.createEl('h4', { text: 'Board lanes' });
  renderAgentBoardLaneEditor(container, plugin);
}
