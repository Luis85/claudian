import { Setting } from 'obsidian';

import type {
  ProviderSettingsWidgetContext,
  ProviderSettingsWidgetMount,
} from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import type { PluginContext } from '../../../core/types/PluginContext';
import {
  addCliPathTextControl,
  validateCliPathAsFile,
  withHostCliPath,
} from '../../../shared/settings/cliPathSetting';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderHiddenProviderCommandsSetting } from '../../../shared/settings/HiddenProviderCommandsSetting';
import { getHostnameKey } from '../../../utils/env';
import { maybeGetOpencodeWorkspaceServices } from '../app/opencodeWorkspaceAccess';
import { clearOpencodeDiscoveryState } from '../discoveryState';
import {
  getOpencodeProviderSettings,
  OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES,
  updateOpencodeProviderSettings,
} from '../settings';
import { mountOpencodeModelAliasesEditor } from './modelAliasesEditor';
import { OpencodeAgentSettings } from './OpencodeAgentSettings';
import { mountOpencodeVisibleModelsPicker } from './visibleModelsPicker';

/**
 * OpenCode settings widgets, extracted from `OpencodeSettingsTab` so the
 * legacy provider tab renderer and the settings-registry custom fields mount
 * the SAME implementation (settings-registry port, Decision 2). Section
 * headings stay with the caller: the legacy tab renders its own
 * `setHeading()` rows, the registry renders section headers from registered
 * sections.
 */

async function recycleOpencodeRuntime(plugin: PluginContext): Promise<void> {
  for (const view of plugin.getAllViews()) {
    const tabManager = view.getTabManager();
    if (tabManager?.broadcastToProviderTabs) {
      await tabManager.broadcastToProviderTabs('opencode', (service) => Promise.resolve(service.cleanup()));
    } else {
      await tabManager?.broadcastToAllTabs(
        (service) => Promise.resolve(service.cleanup()),
      );
    }
    view.invalidateProviderCommandCaches?.(['opencode']);
    view.refreshModelSelector?.();
  }
}

export const mountOpencodeCliPathSetting: ProviderSettingsWidgetMount = (host, context) => {
  const opencodeWorkspace = maybeGetOpencodeWorkspaceServices();
  const settingsBag = asSettingsBag(context.plugin.settings);
  const hostnameKey = getHostnameKey();
  let cliPathsByHost = { ...getOpencodeProviderSettings(settingsBag).cliPathsByHost };

  const setting = new Setting(host)
    .setName('CLI path')
    .setDesc('Optional absolute path to the OpenCode CLI for this computer. Leave empty to use `opencode` from PATH.');

  addCliPathTextControl({
    setting,
    validationHost: host,
    placeholder: process.platform === 'win32'
      ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\opencode.cmd'
      : '/usr/local/bin/opencode',
    currentValue: cliPathsByHost[hostnameKey] || '',
    validate: validateCliPathAsFile,
    persist: async (trimmed) => {
      cliPathsByHost = withHostCliPath(cliPathsByHost, hostnameKey, trimmed);
      updateOpencodeProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      clearOpencodeDiscoveryState(settingsBag);
      await context.plugin.saveSettings();
      opencodeWorkspace?.cliResolver?.reset();
      await recycleOpencodeRuntime(context.plugin);
    },
  });
};

export const mountOpencodeHiddenCommandsSection: ProviderSettingsWidgetMount = (host, context) => {
  const commandsDesc = host.createDiv({ cls: 'claudian-sp-settings-desc' });
  commandsDesc.createEl('p', {
    cls: 'setting-item-description',
    text: 'OpenCode can auto-detect vault-level Claude slash commands from .claude/commands/ and skills from .claude/skills/, .codex/skills/, and .agents/skills/. Manage those entries in the Claude or Codex settings tab. This setting only hides entries from the OpenCode dropdown.',
  });

  renderHiddenProviderCommandsSetting(context.plugin, host, 'opencode', {
    name: 'Hidden Commands and Skills',
    desc: 'Hide specific OpenCode commands and skills from the dropdown. Enter names without the leading slash, one per line.',
    placeholder: 'compact\nreview\nfix',
  });
};

export const mountOpencodeSubagentsSection: ProviderSettingsWidgetMount = (host, context) => {
  const opencodeWorkspace = maybeGetOpencodeWorkspaceServices();
  if (!opencodeWorkspace?.agentStorage) {
    return;
  }

  const subagentsDesc = host.createDiv({ cls: 'claudian-sp-settings-desc' });
  subagentsDesc.createEl('p', {
    cls: 'setting-item-description',
    text: 'Manage vault-level OpenCode subagents from .opencode/agent/ and legacy .opencode/agents/. New entries are saved as subagent-only files and appear in the @mention menu.',
  });

  const subagentsContainer = host.createDiv({ cls: 'claudian-slash-commands-container' });
  new OpencodeAgentSettings(
    subagentsContainer,
    opencodeWorkspace.agentStorage,
    context.plugin.app,
    async () => {
      await opencodeWorkspace.refreshAgentMentions?.();
      await recycleOpencodeRuntime(context.plugin);
    },
  );
};

export function mountOpencodeEnvironmentSection(
  host: HTMLElement,
  context: ProviderSettingsWidgetContext,
  heading?: string,
): void {
  renderEnvironmentSettingsSection({
    container: host,
    plugin: context.plugin,
    scope: 'provider:opencode',
    heading,
    name: 'Environment Variables',
    desc: 'Extra environment variables passed to OpenCode. `OPENCODE_ENABLE_EXA=1` is enabled by default.',
    placeholder: `${OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES}\nOPENCODE_DB=/path/to/opencode.db`,
    renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'opencode'),
  });
}

/** Registry-mountable widget table exposed via `opencodeSettingsTabRenderer.widgets`. */
export const opencodeSettingsWidgets: Readonly<Record<string, ProviderSettingsWidgetMount>> = {
  cliPathsByHost: mountOpencodeCliPathSetting,
  visibleModels: mountOpencodeVisibleModelsPicker,
  modelAliases: mountOpencodeModelAliasesEditor,
  hiddenCommands: mountOpencodeHiddenCommandsSection,
  subagents: mountOpencodeSubagentsSection,
  environment: (host, context) => mountOpencodeEnvironmentSection(host, context),
};
