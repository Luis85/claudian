import { Setting } from 'obsidian';

import type {
  ProviderSettingsWidgetContext,
  ProviderSettingsWidgetMount,
} from '../../../core/providers/settingsWidgets';
import { asSettingsBag } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import {
  addCliPathTextControl,
  broadcastCliPathRuntimeCleanup,
  validateCliPathAsFile,
  withHostCliPath,
} from '../../../shared/settings/cliPathSetting';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderHiddenProviderCommandsSetting } from '../../../shared/settings/HiddenProviderCommandsSetting';
import { McpSettingsManager } from '../../../shared/settings/McpSettingsManager';
import { getHostnameKey } from '../../../utils/env';
import { getClaudeWorkspaceServices } from '../app/claudeWorkspaceAccess';
import {
  isClaudeVaultTrusted,
  setClaudeVaultTrusted,
  vaultProjectSettingsRisky,
} from '../runtime/claudeProjectTrust';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '../settings';
import { AgentSettings } from './AgentSettings';
import { PluginSettingsManager } from './PluginSettingsManager';
import { SlashCommandSettings } from './SlashCommandSettings';

/**
 * Claude settings widgets, extracted from `ClaudeSettingsTab` so the legacy
 * provider tab renderer and the settings-registry custom fields mount the
 * SAME implementation (settings-registry port, Decision 2). Section headings
 * stay with the caller: the legacy tab renders its own `setHeading()` rows,
 * the registry renders section headers from registered sections.
 */

export const mountClaudeCliPathSetting: ProviderSettingsWidgetMount = (host, context) => {
  const claudeWorkspace = getClaudeWorkspaceServices();
  const settingsBag = asSettingsBag(context.plugin.settings);
  const claudeSettings = getClaudeProviderSettings(settingsBag);

  const hostnameKey = getHostnameKey();
  const platformDesc = process.platform === 'win32'
    ? t('settings.cliPath.descWindows')
    : t('settings.cliPath.descUnix');

  const cliPathSetting = new Setting(host)
    .setName(t('settings.cliPath.name'))
    .setDesc(`${t('settings.cliPath.desc')} ${platformDesc}`);

  let cliPathsByHost = { ...claudeSettings.cliPathsByHost };

  addCliPathTextControl({
    setting: cliPathSetting,
    validationHost: host,
    placeholder: process.platform === 'win32'
      ? 'D:\\nodejs\\node_global\\node_modules\\@anthropic-ai\\claude-code\\cli-wrapper.cjs'
      : '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs',
    currentValue: claudeSettings.cliPathsByHost[hostnameKey] || '',
    validate: validateCliPathAsFile,
    persist: async (trimmed) => {
      cliPathsByHost = withHostCliPath(cliPathsByHost, hostnameKey, trimmed);
      updateClaudeProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      claudeWorkspace.cliResolver?.reset();
      await broadcastCliPathRuntimeCleanup(context.plugin);
    },
  });
};

// SEC-2: per-vault trust gate. When the vault's `.claude/settings.json` ships
// risky hooks / permissions.allow, those sources are withheld until trusted.
// The toggle reflects the live trust state and lets the user grant trust
// pre-emptively (before risky settings exist) or revoke it. The previous
// `setDisabled(!vaultRisky && !isTrusted)` guard blocked toggling on clean
// vaults — but the trust-map write is harmless and the `descSafe` copy
// already encourages pre-emptive trust.
export const mountClaudeTrustVaultSetting: ProviderSettingsWidgetMount = (host, context) => {
  const vaultRisky = vaultProjectSettingsRisky(context.plugin);
  const trustSetting = new Setting(host)
    .setName(t('settings.trustVault.name'))
    .setDesc(
      vaultRisky
        ? t('settings.trustVault.descRisky')
        : t('settings.trustVault.descSafe'),
    );
  trustSetting.addToggle((toggle) =>
    toggle
      .setValue(isClaudeVaultTrusted(context.plugin))
      .onChange(async (value) => {
        await setClaudeVaultTrusted(context.plugin, value);
      }),
  );
};

function mountModelVariantToggle(
  host: HTMLElement,
  context: ProviderSettingsWidgetContext,
  variant: 'enableOpus1M' | 'enableSonnet1M',
  copy: { name: string; desc: string },
): void {
  const settingsBag = asSettingsBag(context.plugin.settings);
  const claudeSettings = getClaudeProviderSettings(settingsBag);
  new Setting(host)
    .setName(copy.name)
    .setDesc(copy.desc)
    .addToggle((toggle) =>
      toggle
        .setValue(claudeSettings[variant])
        .onChange(async (value) => {
          updateClaudeProviderSettings(settingsBag, { [variant]: value });
          context.plugin.normalizeModelVariantSettings();
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        })
    );
}

export const mountClaudeOpus1MToggle: ProviderSettingsWidgetMount = (host, context) => {
  mountModelVariantToggle(host, context, 'enableOpus1M', {
    name: t('settings.enableOpus1M.name'),
    desc: t('settings.enableOpus1M.desc'),
  });
};

export const mountClaudeSonnet1MToggle: ProviderSettingsWidgetMount = (host, context) => {
  mountModelVariantToggle(host, context, 'enableSonnet1M', {
    name: t('settings.enableSonnet1M.name'),
    desc: t('settings.enableSonnet1M.desc'),
  });
};

export const mountClaudeSlashCommandsSection: ProviderSettingsWidgetMount = (host, context) => {
  const slashCommandsDesc = host.createDiv({ cls: 'specorator-sp-settings-desc' });
  const descP = slashCommandsDesc.createEl('p', { cls: 'setting-item-description' });
  descP.appendText(t('settings.slashCommands.desc') + ' ');
  descP.createEl('a', {
    text: 'Learn more',
    href: 'https://code.claude.com/docs/en/skills',
  });

  const slashCommandsContainer = host.createDiv({ cls: 'specorator-slash-commands-container' });
  new SlashCommandSettings(
    slashCommandsContainer,
    context.plugin.app,
    getClaudeWorkspaceServices().commandCatalog,
  );
};

export const mountClaudeSubagentsSection: ProviderSettingsWidgetMount = (host, context) => {
  const claudeWorkspace = getClaudeWorkspaceServices();
  const agentsDesc = host.createDiv({ cls: 'specorator-sp-settings-desc' });
  agentsDesc.createEl('p', {
    text: t('settings.subagents.desc'),
    cls: 'setting-item-description',
  });

  const agentsContainer = host.createDiv({ cls: 'specorator-agents-container' });
  new AgentSettings(agentsContainer, {
    app: context.plugin.app,
    agentManager: claudeWorkspace.agentManager,
    agentStorage: claudeWorkspace.agentStorage,
  });
};

export const mountClaudeMcpSection: ProviderSettingsWidgetMount = (host, context) => {
  const claudeWorkspace = getClaudeWorkspaceServices();
  const mcpDesc = host.createDiv({ cls: 'specorator-mcp-settings-desc' });
  mcpDesc.createEl('p', {
    text: t('settings.mcpServers.desc'),
    cls: 'setting-item-description',
  });

  const mcpContainer = host.createDiv({ cls: 'specorator-mcp-container' });
  new McpSettingsManager(mcpContainer, {
    app: context.plugin.app,
    mcpStorage: claudeWorkspace.mcpStorage,
    secretStore: context.plugin.secretStore,
    broadcastMcpReload: async () => {
      for (const view of context.plugin.getAllViews()) {
        await view.getTabManager()?.broadcastToAllTabs(
          (service) => service.reloadMcpServers(),
        );
      }
    },
    warnMissingMcpSecrets: (missing) => context.plugin.warnMissingMcpSecrets(missing),
  });
};

export const mountClaudePluginsSection: ProviderSettingsWidgetMount = (host, context) => {
  const claudeWorkspace = getClaudeWorkspaceServices();
  const pluginsDesc = host.createDiv({ cls: 'specorator-plugin-settings-desc' });
  pluginsDesc.createEl('p', {
    text: t('settings.plugins.desc'),
    cls: 'setting-item-description',
  });

  const pluginsContainer = host.createDiv({ cls: 'specorator-plugins-container' });
  new PluginSettingsManager(pluginsContainer, {
    pluginManager: claudeWorkspace.pluginManager,
    agentManager: claudeWorkspace.agentManager,
    restartTabs: async () => {
      const view = context.plugin.getView();
      const tabManager = view?.getTabManager();
      if (!tabManager) {
        return;
      }

      await tabManager.broadcastToAllTabs(
        async (service) => { await service.ensureReady({ force: true }); },
      );
    },
  });
};

export function mountClaudeEnvironmentSection(
  host: HTMLElement,
  context: ProviderSettingsWidgetContext,
  heading?: string,
): void {
  renderEnvironmentSettingsSection({
    container: host,
    plugin: context.plugin,
    scope: 'provider:claude',
    heading,
    name: t('settings.customVariables.name'),
    desc: 'Claude-owned runtime variables only. Use this for ANTHROPIC_* and Claude-specific toggles.',
    placeholder: 'ANTHROPIC_API_KEY=your-key\nANTHROPIC_BASE_URL=https://api.example.com\nANTHROPIC_MODEL=custom-model\nCLAUDE_CODE_USE_BEDROCK=1',
    renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'claude'),
  });
}

export const mountClaudeBangBashToggle: ProviderSettingsWidgetMount = (host, context) => {
  const settingsBag = asSettingsBag(context.plugin.settings);
  const claudeSettings = getClaudeProviderSettings(settingsBag);

  new Setting(host)
    .setName(t('settings.enableBangBash.name'))
    .setDesc(t('settings.enableBangBash.desc'))
    .addToggle((toggle) =>
      toggle
        .setValue(claudeSettings.enableBangBash)
        .onChange(async (value) => {
          bangBashValidationEl.toggleClass('specorator-hidden', true);
          if (value) {
            const { findNodeExecutable, getEnhancedPath } = await import('../../../utils/env');
            const nodePath = findNodeExecutable(getEnhancedPath());
            if (!nodePath) {
              bangBashValidationEl.setText(t('settings.enableBangBash.validation.noNode'));
              bangBashValidationEl.toggleClass('specorator-hidden', false);
              toggle.setValue(false);
              return;
            }
          }
          updateClaudeProviderSettings(settingsBag, { enableBangBash: value });
          await context.plugin.saveSettings();
        })
    );

  const bangBashValidationEl = host.createDiv({
    cls: 'specorator-bang-bash-validation specorator-setting-validation specorator-setting-validation-error specorator-hidden',
  });
};

export const mountClaudeHiddenCommandsSetting: ProviderSettingsWidgetMount = (host, context) => {
  renderHiddenProviderCommandsSetting(context.plugin, host, 'claude', {
    name: t('settings.hiddenSlashCommands.name'),
    desc: t('settings.hiddenSlashCommands.desc'),
    placeholder: t('settings.hiddenSlashCommands.placeholder'),
  });
};

/** Registry-mountable widget table exposed via `claudeSettingsTabRenderer.widgets`. */
export const claudeSettingsWidgets: Readonly<Record<string, ProviderSettingsWidgetMount>> = {
  cliPathsByHost: mountClaudeCliPathSetting,
  trustVault: mountClaudeTrustVaultSetting,
  enableOpus1M: mountClaudeOpus1MToggle,
  enableSonnet1M: mountClaudeSonnet1MToggle,
  slashCommands: mountClaudeSlashCommandsSection,
  hiddenCommands: mountClaudeHiddenCommandsSetting,
  subagents: mountClaudeSubagentsSection,
  mcpServers: mountClaudeMcpSection,
  plugins: mountClaudePluginsSection,
  environment: (host, context) => mountClaudeEnvironmentSection(host, context),
  enableBangBash: mountClaudeBangBashToggle,
};
