import { Setting } from 'obsidian';

import {
  getHiddenProviderCommands,
  normalizeHiddenCommandList,
} from '../../core/providers/commands/hiddenCommands';
import type { ProviderId } from '../../core/providers/types';
import type { PluginContext } from '../../core/types/PluginContext';

export interface HiddenProviderCommandsCopy {
  name: string;
  desc: string;
  placeholder: string;
}

/**
 * Hidden provider commands editor (one command name per line, leading `/`/`$`
 * stripped). Mirrors `ClaudianSettings.renderHiddenProviderCommandSetting` so
 * provider settings widgets can mount the same control through the registry
 * without reaching back into the settings shell.
 */
export function renderHiddenProviderCommandsSetting(
  plugin: PluginContext,
  container: HTMLElement,
  providerId: ProviderId,
  copy: HiddenProviderCommandsCopy,
): void {
  new Setting(container)
    .setName(copy.name)
    .setDesc(copy.desc)
    .addTextArea((text) => {
      text
        .setPlaceholder(copy.placeholder)
        .setValue(getHiddenProviderCommands(plugin.settings, providerId).join('\n'))
        .onChange(async (value) => {
          plugin.settings.hiddenProviderCommands = {
            ...plugin.settings.hiddenProviderCommands,
            [providerId]: normalizeHiddenCommandList(value.split(/\r?\n/)),
          };
          await plugin.saveSettings();
          plugin.getView()?.updateHiddenProviderCommands?.();
        });
      text.inputEl.rows = 4;
      text.inputEl.cols = 30;
    });
}
