import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import { t } from '../../../../i18n/i18n';
import { CustomModelsTable } from '../../customModels/CustomModelsTable';
import { renderProviderSettingsWidget } from '../providers/providerWidgets';
import { registerProviderTab } from '../providers/registerProviderTab';
import { getSettingsRegistry } from '../registry';

// Field definitions mirror the legacy `opencodeSettingsTabRenderer` (the
// parity source of truth — see tests/integration/settings/opencodePort).
// Pure value-backed fields are native registry kinds with ids equal to their
// persisted settings paths; the complex widgets (CLI-path validation +
// runtime recycle, visible-models picker, alias editor, hidden commands,
// subagents, environment) mount the SAME widget code the legacy tab uses,
// via the provider `widgets` seam.
//
// Deliberately absent: the provider `enabled` toggle. The General tab owns
// `providerConfigs.opencode.enabled` (field ids are registry-unique), and
// this tab is only visible while OpenCode is enabled.
export function registerOpencodeTabFields(): void {
  const r = getSettingsRegistry();

  registerProviderTab(r, {
    providerId: 'opencode',
    label: 'Opencode',
    order: 40,
    sections: [
      { id: 'setup', label: t('settings.setup'), order: 10 },
      { id: 'models', label: t('settings.models'), order: 20 },
      { id: 'commands', label: 'Commands and skills', order: 30 },
      { id: 'subagents', label: t('settings.subagents.name'), order: 40 },
      { id: 'environment', label: t('settings.environment'), order: 50 },
    ],
  });

  registerSetupFields(r);
  registerModelFields(r);
  registerWorkspaceWidgetFields(r);
}

type Registry = ReturnType<typeof getSettingsRegistry>;

function registerSetupFields(r: Registry): void {
  // Decision 1: the persisted shape is the hostname-keyed map, not a flat
  // string. The widget edits the current host's entry.
  r.registerField({
    id: 'providerConfigs.opencode.cliPathsByHost',
    tabId: 'opencode',
    sectionId: 'setup',
    label: 'CLI path',
    description:
      'Optional absolute path to the OpenCode CLI for this computer. Leave empty to use `opencode` from PATH.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'opencode', 'cliPathsByHost'),
    },
    default: null,
    keywords: ['cli', 'path', 'executable', 'binary', 'opencode'],
  });
}

function registerModelFields(r: Registry): void {
  r.registerField({
    id: 'providerConfigs.opencode.selectedMode',
    tabId: 'opencode',
    sectionId: 'models',
    label: 'Selected mode',
    description: 'Default Opencode mode for new conversations',
    type: {
      kind: 'dropdown',
      options: (settings) => {
        const config = ProviderRegistry.getChatUIConfig('opencode');
        const modes = config.getAvailableModes?.(settings as Record<string, unknown>) ?? [];
        return modes.map((mode) => ({ value: mode.id, label: mode.label }));
      },
    },
    default: '',
    keywords: ['mode', 'agent', 'plan', 'default'],
  });

  r.registerField({
    id: 'providerConfigs.opencode.visibleModels',
    tabId: 'opencode',
    sectionId: 'models',
    label: 'Visible models',
    description:
      'Choose which OpenCode models appear in the chat selector. Filter by provider or type to search.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'opencode', 'visibleModels'),
    },
    default: null,
    keywords: ['visible', 'models', 'picker', 'catalog', 'selector'],
  });

  r.registerField({
    id: 'providerConfigs.opencode.modelAliases',
    tabId: 'opencode',
    sectionId: 'models',
    label: 'Model aliases',
    description: 'Custom labels for the selected OpenCode models in the model selector.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'opencode', 'modelAliases'),
    },
    default: null,
    keywords: ['alias', 'aliases', 'label', 'rename', 'selected models'],
  });

  r.registerField({
    id: 'providerConfigs.opencode.customModels',
    tabId: 'opencode',
    sectionId: 'models',
    label: 'Custom models',
    description: 'Add custom model ids with optional aliases and context windows.',
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        const table = new CustomModelsTable(host, 'opencode', ctx);
        table.render();
      },
    },
    default: null,
    keywords: ['custom', 'models', 'model id', 'context window'],
  });
}

function registerWorkspaceWidgetFields(r: Registry): void {
  r.registerField({
    id: 'hiddenProviderCommands.opencode',
    tabId: 'opencode',
    sectionId: 'commands',
    label: 'Hidden Commands and Skills',
    description:
      'Hide specific OpenCode commands and skills from the dropdown. Enter names without the leading slash, one per line.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'opencode', 'hiddenCommands'),
    },
    default: null,
    keywords: ['hidden', 'commands', 'skills', 'slash', 'dropdown'],
  });

  r.registerField({
    id: 'opencode.subagents',
    tabId: 'opencode',
    sectionId: 'subagents',
    label: 'Vault subagents',
    description:
      'Manage vault-level OpenCode subagents from .opencode/agent/ and legacy .opencode/agents/.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'opencode', 'subagents'),
    },
    default: null,
    keywords: ['subagents', 'agents', 'mention', 'vault'],
  });

  r.registerField({
    id: 'providerConfigs.opencode.environmentVariables',
    tabId: 'opencode',
    sectionId: 'environment',
    label: 'Environment Variables',
    description:
      'Extra environment variables passed to OpenCode. `OPENCODE_ENABLE_EXA=1` is enabled by default.',
    type: {
      kind: 'custom',
      // Heading intentionally omitted: the section walker renders it.
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'opencode', 'environment'),
    },
    default: '',
    keywords: ['environment', 'env', 'variables', 'secrets', 'opencode'],
  });
}
