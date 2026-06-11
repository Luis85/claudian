import { t } from '../../../../i18n/i18n';
import { CustomModelsTable } from '../../customModels/CustomModelsTable';
import { renderProviderSettingsWidget } from '../providers/providerWidgets';
import { registerProviderTab } from '../providers/registerProviderTab';
import { getSettingsRegistry } from '../registry';

// Field definitions mirror the legacy `claudeSettingsTabRenderer` (the parity
// source of truth — see tests/integration/settings/claudePort). Pure
// value-backed fields are native registry kinds with ids equal to their
// persisted settings paths; everything with side effects (CLI-path validation
// + runtime restarts, model-variant normalization, node detection) or composite
// DOM (commands, subagents, MCP, plugins, environment) mounts the SAME widget
// code the legacy tab uses, via the provider `widgets` seam.
//
// Deliberately absent: the provider `enabled` toggle. The General tab owns
// `providerConfigs.claude.enabled` (field ids are registry-unique), and this
// tab is only visible while Claude is enabled.
export function registerClaudeTabFields(): void {
  const r = getSettingsRegistry();

  registerProviderTab(r, {
    providerId: 'claude',
    label: 'Claude',
    order: 10,
    sections: [
      { id: 'setup', label: t('settings.setup'), order: 10 },
      { id: 'safety', label: t('settings.safety'), order: 20 },
      { id: 'models', label: t('settings.models'), order: 30 },
      { id: 'commands', label: t('settings.slashCommands.name'), order: 40 },
      { id: 'subagents', label: t('settings.subagents.name'), order: 50 },
      { id: 'mcp', label: t('settings.mcpServers.name'), order: 60 },
      { id: 'plugins', label: t('settings.plugins.name'), order: 70 },
      { id: 'environment', label: t('settings.environment'), order: 80 },
      { id: 'experimental', label: t('settings.experimental'), order: 90 },
    ],
  });

  registerSetupAndSafetyFields(r);
  registerModelFields(r);
  registerWorkspaceWidgetFields(r);
  registerExperimentalFields(r);
}

type Registry = ReturnType<typeof getSettingsRegistry>;

function registerSetupAndSafetyFields(r: Registry): void {
  // Decision 1: the persisted shape is the hostname-keyed map, not a flat
  // string. The widget edits the current host's entry.
  r.registerField({
    id: 'providerConfigs.claude.cliPathsByHost',
    tabId: 'claude',
    sectionId: 'setup',
    label: t('settings.cliPath.name'),
    description: t('settings.cliPath.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'cliPathsByHost'),
    },
    default: null,
    keywords: ['cli', 'path', 'executable', 'binary', 'claude code'],
  });

  r.registerField({
    id: 'providerConfigs.claude.safeMode',
    tabId: 'claude',
    sectionId: 'safety',
    label: t('settings.claudeSafeMode.name'),
    description: t('settings.claudeSafeMode.desc'),
    type: {
      kind: 'dropdown',
      options: () => [
        { value: 'acceptEdits', label: 'acceptEdits' },
        { value: 'auto', label: 'auto' },
        { value: 'default', label: 'default' },
      ],
    },
    default: 'acceptEdits',
    keywords: ['safe', 'mode', 'permission', 'approval'],
  });

  r.registerField({
    id: 'providerConfigs.claude.loadUserSettings',
    tabId: 'claude',
    sectionId: 'safety',
    label: t('settings.loadUserSettings.name'),
    description: t('settings.loadUserSettings.desc'),
    type: { kind: 'toggle' },
    default: true,
    keywords: ['user settings', 'permissions', 'claude code', 'settings.json'],
  });

  r.registerField({
    id: 'claude.trustVault',
    tabId: 'claude',
    sectionId: 'safety',
    label: t('settings.trustVault.name'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'trustVault'),
    },
    default: null,
    keywords: ['trust', 'vault', 'project', 'hooks', 'security'],
  });
}

function registerModelFields(r: Registry): void {
  r.registerField({
    id: 'providerConfigs.claude.enableOpus1M',
    tabId: 'claude',
    sectionId: 'models',
    label: t('settings.enableOpus1M.name'),
    description: t('settings.enableOpus1M.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'enableOpus1M'),
    },
    default: false,
    keywords: ['opus', '1m', 'context window', 'model'],
  });

  r.registerField({
    id: 'providerConfigs.claude.enableSonnet1M',
    tabId: 'claude',
    sectionId: 'models',
    label: t('settings.enableSonnet1M.name'),
    description: t('settings.enableSonnet1M.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'enableSonnet1M'),
    },
    default: false,
    keywords: ['sonnet', '1m', 'context window', 'model'],
  });

  r.registerField({
    id: 'providerConfigs.claude.customModels',
    tabId: 'claude',
    sectionId: 'models',
    label: t('settings.customModels.name'),
    description: t('settings.customModels.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        const table = new CustomModelsTable(host, 'claude', ctx);
        table.render();
      },
    },
    default: null,
    keywords: ['custom', 'models', 'model id', 'alias'],
  });
}

function registerWorkspaceWidgetFields(r: Registry): void {
  r.registerField({
    id: 'claude.slashCommands',
    tabId: 'claude',
    sectionId: 'commands',
    label: t('settings.slashCommands.name'),
    description: t('settings.slashCommands.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'slashCommands'),
    },
    default: null,
    keywords: ['slash', 'commands', 'skills', 'vault'],
  });

  r.registerField({
    id: 'hiddenProviderCommands.claude',
    tabId: 'claude',
    sectionId: 'commands',
    label: t('settings.hiddenSlashCommands.name'),
    description: t('settings.hiddenSlashCommands.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'hiddenCommands'),
    },
    default: null,
    keywords: ['hidden', 'commands', 'skills', 'dropdown'],
  });

  r.registerField({
    id: 'claude.subagents',
    tabId: 'claude',
    sectionId: 'subagents',
    label: t('settings.subagents.name'),
    description: t('settings.subagents.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'subagents'),
    },
    default: null,
    keywords: ['subagents', 'agents', 'custom agent'],
  });

  r.registerField({
    id: 'claude.mcpServers',
    tabId: 'claude',
    sectionId: 'mcp',
    label: t('settings.mcpServers.name'),
    description: t('settings.mcpServers.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'mcpServers'),
    },
    default: null,
    keywords: ['mcp', 'servers', 'model context protocol', 'tools'],
  });

  r.registerField({
    id: 'claude.plugins',
    tabId: 'claude',
    sectionId: 'plugins',
    label: t('settings.plugins.name'),
    description: t('settings.plugins.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'plugins'),
    },
    default: null,
    keywords: ['plugins', 'claude code', 'marketplace'],
  });

  r.registerField({
    id: 'providerConfigs.claude.environmentVariables',
    tabId: 'claude',
    sectionId: 'environment',
    label: t('settings.customVariables.name'),
    description:
      'Claude-owned runtime variables only. Use this for ANTHROPIC_* and Claude-specific toggles.',
    type: {
      kind: 'custom',
      // Heading intentionally omitted: the section walker renders it.
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'environment'),
    },
    default: '',
    keywords: ['environment', 'env', 'variables', 'anthropic', 'api key', 'secrets'],
  });
}

function registerExperimentalFields(r: Registry): void {
  r.registerField({
    id: 'providerConfigs.claude.enableChrome',
    tabId: 'claude',
    sectionId: 'experimental',
    label: t('settings.enableChrome.name'),
    description: t('settings.enableChrome.desc'),
    type: { kind: 'toggle' },
    default: false,
    keywords: ['chrome', 'browser', 'extension'],
  });

  r.registerField({
    id: 'providerConfigs.claude.enableBangBash',
    tabId: 'claude',
    sectionId: 'experimental',
    label: t('settings.enableBangBash.name'),
    description: t('settings.enableBangBash.desc'),
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'claude', 'enableBangBash'),
    },
    default: false,
    keywords: ['bash', 'shell', '!', 'terminal'],
  });
}
