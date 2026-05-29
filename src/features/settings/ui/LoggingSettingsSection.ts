import { Notice, Setting } from 'obsidian';

import type { LogLevel } from '../../../core/logging/types';
import type ClaudianPlugin from '../../../main';

const LEVEL_OPTIONS: Array<{ value: LogLevel; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

export function renderLoggingSettingsSection(
  container: HTMLElement,
  plugin: ClaudianPlugin,
): void {
  new Setting(container).setName('Diagnostics').setHeading();

  new Setting(container)
    .setName('Enable logging')
    .setDesc('Capture diagnostic logs to the developer console and an in-memory buffer.')
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.loggingEnabled ?? false)
        .onChange(async (value) => {
          plugin.settings.loggingEnabled = value;
          plugin.logger.setEnabled(value);
          await plugin.saveSettings();
        }),
    );

  new Setting(container)
    .setName('Log level')
    .setDesc('Minimum level captured. Debug is the most verbose.')
    .addDropdown((dropdown) => {
      for (const option of LEVEL_OPTIONS) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown
        .setValue(plugin.settings.logLevel ?? 'warn')
        .onChange(async (value) => {
          plugin.settings.logLevel = value as LogLevel;
          plugin.logger.setLevel(value as LogLevel);
          await plugin.saveSettings();
        });
    });

  new Setting(container)
    .setName('Diagnostic log buffer')
    .setDesc('Copy recent log entries to the clipboard, or clear the buffer.')
    .addButton((button) =>
      button
        .setButtonText('Copy logs')
        .onClick(() => { void plugin.copyDiagnosticLogs(); }),
    )
    .addButton((button) =>
      button
        .setButtonText('Clear logs')
        .onClick(() => {
          plugin.logger.clear();
          new Notice('Diagnostic logs cleared');
        }),
    );
}
