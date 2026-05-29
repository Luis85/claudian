import { Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';

export function renderQuickActionsSettingsTab(
  container: HTMLElement,
  plugin: ClaudianPlugin,
): void {
  new Setting(container)
    .setName(t('settings.quickActions.folder.name'))
    .setDesc(t('settings.quickActions.folder.desc'))
    .addText((text) => {
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- folder name default, not prose.
        .setPlaceholder('Quick Actions')
        .setValue(plugin.settings.quickActionsFolder ?? 'Quick Actions')
        .onChange(async (value) => {
          plugin.settings.quickActionsFolder = value.trim() || 'Quick Actions';
          await plugin.saveSettings();
        });
    });
}
