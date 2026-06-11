import { Setting } from 'obsidian';

import type {
  ProviderSettingsWidgetContext,
  ProviderSettingsWidgetMount,
} from '../../../core/providers/settingsWidgets';
import { asSettingsBag } from '../../../core/types';
import {
  addCliPathTextControl,
  broadcastCliPathRuntimeCleanup,
  validateCliPathAsFile,
  withHostCliPath,
} from '../../../shared/settings/cliPathSetting';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderHiddenProviderCommandsSetting } from '../../../shared/settings/HiddenProviderCommandsSetting';
import { getHostnameKey } from '../../../utils/env';
import { getCodexWorkspaceServices } from '../app/codexWorkspaceAccess';
import { isWindowsStyleCliReference } from '../runtime/CodexBinaryLocator';
import { getCodexProviderSettings, updateCodexProviderSettings } from '../settings';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '../types/models';
import { CodexSkillSettings } from './CodexSkillSettings';
import { CodexSubagentSettings } from './CodexSubagentSettings';

/**
 * Codex settings widgets, extracted from `CodexSettingsTab` so the legacy
 * provider tab renderer and the settings-registry custom fields mount the
 * SAME implementation (settings-registry port, Decision 2). Cross-widget
 * dependencies (installation method → CLI-path copy/validation → WSL distro
 * enablement) are resolved by re-rendering: the installation-method dropdown
 * calls `context.requestRefresh()` and every widget reads the persisted
 * installation method at mount.
 */

function isWindowsHost(): boolean {
  return process.platform === 'win32';
}

export const mountCodexInstallationMethodSetting: ProviderSettingsWidgetMount = (host, context) => {
  const settingsBag = asSettingsBag(context.plugin.settings);
  const codexSettings = getCodexProviderSettings(settingsBag);

  new Setting(host)
    .setName('Installation method')
    .setDesc('How Claudian should launch Codex on Windows. Native Windows uses a Windows executable path. WSL launches the Linux CLI inside a selected distro.')
    .addDropdown((dropdown) => {
      dropdown
        .addOption('native-windows', 'Native Windows')
        .addOption('wsl', 'WSL')
        .setValue(codexSettings.installationMethod)
        .onChange(async (value) => {
          updateCodexProviderSettings(settingsBag, {
            installationMethod: value === 'wsl' ? 'wsl' : 'native-windows',
          });
          await context.plugin.saveSettings();
          context.requestRefresh();
        });
    });
};

function getCodexCliPathCopy(
  installationMethod: 'native-windows' | 'wsl',
): { desc: string; placeholder: string } {
  if (!isWindowsHost()) {
    return {
      desc: 'Custom path to the local Codex CLI. Leave empty for auto-detection from PATH.',
      placeholder: '/usr/local/bin/codex',
    };
  }

  if (installationMethod === 'wsl') {
    return {
      desc: 'Linux-side Codex command or absolute path to run inside WSL. Leave empty for PATH lookup inside the selected distro.',
      placeholder: 'codex',
    };
  }

  return {
    desc: 'Custom path to the local Codex CLI. Leave empty for auto-detection from PATH. Use the native Windows executable path, usually `codex.exe`.',
    placeholder: 'C:\\Users\\you\\AppData\\Roaming\\npm\\codex.exe',
  };
}

function validateCodexCliPath(
  value: string,
  installationMethod: 'native-windows' | 'wsl',
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isWindowsHost() && installationMethod === 'wsl') {
    if (isWindowsStyleCliReference(trimmed)) {
      return 'WSL mode expects a Linux command or Linux absolute path, not a Windows executable path.';
    }
    return null;
  }

  return validateCliPathAsFile(value);
}

export const mountCodexCliPathSetting: ProviderSettingsWidgetMount = (host, context) => {
  const settingsBag = asSettingsBag(context.plugin.settings);
  const codexSettings = getCodexProviderSettings(settingsBag);
  const hostnameKey = getHostnameKey();
  const installationMethod = codexSettings.installationMethod;
  const cliCopy = getCodexCliPathCopy(installationMethod);

  const cliPathSetting = new Setting(host)
    .setName('Codex CLI path')
    .setDesc(cliCopy.desc);

  let cliPathsByHost = { ...codexSettings.cliPathsByHost };

  addCliPathTextControl({
    setting: cliPathSetting,
    validationHost: host,
    placeholder: cliCopy.placeholder,
    currentValue: codexSettings.cliPathsByHost[hostnameKey] || '',
    validate: (value) => validateCodexCliPath(value, installationMethod),
    persist: async (trimmed) => {
      cliPathsByHost = withHostCliPath(cliPathsByHost, hostnameKey, trimmed);
      updateCodexProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      await broadcastCliPathRuntimeCleanup(context.plugin);
    },
  });
};

export const mountCodexWslDistroOverrideSetting: ProviderSettingsWidgetMount = (host, context) => {
  const settingsBag = asSettingsBag(context.plugin.settings);
  const codexSettings = getCodexProviderSettings(settingsBag);
  const isWslMode = codexSettings.installationMethod === 'wsl';

  const wslDistroSetting = new Setting(host)
    .setName('WSL distro override')
    .setDesc('Optional advanced override. Leave empty to infer the distro from a WSL workspace path when possible, otherwise use the default WSL distro.');

  wslDistroSetting.settingEl.toggleClass('claudian-hidden', !isWslMode);
  wslDistroSetting.addText((text) => {
    text
      .setPlaceholder('Ubuntu')
      .setValue(codexSettings.wslDistroOverride)
      .onChange(async (value) => {
        updateCodexProviderSettings(settingsBag, { wslDistroOverride: value });
        await context.plugin.saveSettings();
      });

    text.inputEl.addClass('claudian-settings-cli-path-input');
    text.inputEl.disabled = !isWslMode;
  });
};

export const mountCodexSkillsSection: ProviderSettingsWidgetMount = (host, context) => {
  const codexCatalog = getCodexWorkspaceServices().commandCatalog;
  if (!codexCatalog) {
    return;
  }

  const skillsDesc = host.createDiv({ cls: 'claudian-sp-settings-desc' });
  skillsDesc.createEl('p', {
    cls: 'setting-item-description',
    text: 'Manage vault-level Codex skills stored in .codex/skills/ or .agents/skills/. Home-level skills are excluded here.',
  });

  const skillsContainer = host.createDiv({ cls: 'claudian-slash-commands-container' });
  new CodexSkillSettings(skillsContainer, codexCatalog, context.plugin.app);
};

export const mountCodexHiddenSkillsSetting: ProviderSettingsWidgetMount = (host, context) => {
  renderHiddenProviderCommandsSetting(context.plugin, host, 'codex', {
    name: 'Hidden Skills',
    desc: 'Hide specific Codex skills from the dropdown. Enter skill names without the leading $, one per line.',
    placeholder: 'analyze\nexplain\nfix',
  });
};

export const mountCodexSubagentsSection: ProviderSettingsWidgetMount = (host, context) => {
  const codexWorkspace = getCodexWorkspaceServices();

  const subagentDesc = host.createDiv({ cls: 'claudian-sp-settings-desc' });
  subagentDesc.createEl('p', {
    cls: 'setting-item-description',
    text: 'Manage vault-level Codex subagents stored in .codex/agents/. Each TOML file defines one custom agent.',
  });

  const subagentContainer = host.createDiv({ cls: 'claudian-slash-commands-container' });
  new CodexSubagentSettings(subagentContainer, codexWorkspace.subagentStorage, context.plugin.app, () => {
    void codexWorkspace.refreshAgentMentions?.();
  });
};

export const mountCodexMcpNotice: ProviderSettingsWidgetMount = (host) => {
  const mcpNotice = host.createDiv({ cls: 'claudian-mcp-settings-desc' });
  const mcpDesc = mcpNotice.createEl('p', { cls: 'setting-item-description' });
  mcpDesc.appendText('Codex manages MCP servers via its own CLI. Configure with ');
  mcpDesc.createEl('code').appendText('codex mcp');
  mcpDesc.appendText(' and they will be available in Claudian. ');
  mcpDesc.createEl('a', {
    text: 'Learn more',
    href: 'https://developers.openai.com/codex/mcp',
  });
};

export function mountCodexEnvironmentSection(
  host: HTMLElement,
  context: ProviderSettingsWidgetContext,
  heading?: string,
): void {
  renderEnvironmentSettingsSection({
    container: host,
    plugin: context.plugin,
    scope: 'provider:codex',
    heading,
    name: 'Codex environment',
    desc: 'Codex-owned runtime variables only. Use this for OPENAI_* and CODEX_* settings. If Codex auto-detection needs help, add its install directory to shared PATH instead of this provider section.',
    placeholder: `OPENAI_API_KEY=your-key\nOPENAI_BASE_URL=https://api.openai.com/v1\nOPENAI_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}\nCODEX_SANDBOX=workspace-write`,
    renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'codex'),
  });
}

/** Registry-mountable widget table exposed via `codexSettingsTabRenderer.widgets`. */
export const codexSettingsWidgets: Readonly<Record<string, ProviderSettingsWidgetMount>> = {
  installationMethod: mountCodexInstallationMethodSetting,
  cliPathsByHost: mountCodexCliPathSetting,
  wslDistroOverride: mountCodexWslDistroOverrideSetting,
  skills: mountCodexSkillsSection,
  hiddenCommands: mountCodexHiddenSkillsSetting,
  subagents: mountCodexSubagentsSection,
  mcpNotice: mountCodexMcpNotice,
  environment: (host, context) => mountCodexEnvironmentSection(host, context),
};
