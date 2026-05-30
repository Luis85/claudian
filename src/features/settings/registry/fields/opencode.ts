import { getOpencodeProviderSettings } from '../../../../providers/opencode/settings';
import { CustomModelsTable } from '../../customModels/CustomModelsTable';
import { registerProviderTab } from '../providers/registerProviderTab';
import { getSettingsRegistry } from '../registry';

export function registerOpencodeTabFields(): void {
  const r = getSettingsRegistry();

  registerProviderTab(r, {
    providerId: 'opencode',
    label: 'Opencode',
    order: 40,
    sections: [
      { id: 'setup', label: 'Setup', order: 10 },
      { id: 'models', label: 'Models', order: 20 },
      { id: 'commands', label: 'Commands', order: 30 },
      { id: 'subagents', label: 'Subagents', order: 40 },
      { id: 'environment', label: 'Environment', order: 50 },
    ],
  });

  r.registerField({
    id: 'providerConfigs.opencode.cliPath',
    tabId: 'opencode',
    sectionId: 'setup',
    label: 'CLI path',
    description: 'Path to opencode CLI executable',
    type: { kind: 'text', placeholder: '/usr/local/bin/opencode' },
    default: '',
  });

  r.registerField({
    id: 'providerConfigs.opencode.selectedMode',
    tabId: 'opencode',
    sectionId: 'models',
    label: 'Selected mode',
    description: 'Default Opencode mode for new conversations',
    type: {
      kind: 'dropdown',
      options: (settings) => {
        const { availableModes } = getOpencodeProviderSettings(
          settings as unknown as Record<string, unknown>,
        );
        return availableModes
          .filter((mode) => typeof mode.id === 'string' && mode.id.length > 0)
          .map((mode) => ({ value: mode.id, label: mode.name || mode.id }));
      },
    },
    default: '',
  });

  r.registerField({
    id: 'providerConfigs.opencode.visibleModels',
    tabId: 'opencode',
    sectionId: 'models',
    label: 'Visible models',
    type: { kind: 'custom', render: () => undefined },
    default: null,
  });

  r.registerField({
    id: 'providerConfigs.opencode.modelAliases',
    tabId: 'opencode',
    sectionId: 'models',
    label: 'Model aliases',
    type: { kind: 'custom', render: () => undefined },
    default: null,
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
  });

  r.registerField({
    id: 'providerConfigs.opencode.commands',
    tabId: 'opencode',
    sectionId: 'commands',
    label: 'Vault commands and skills',
    type: { kind: 'custom', render: () => undefined },
    default: null,
  });

  r.registerField({
    id: 'providerConfigs.opencode.subagents',
    tabId: 'opencode',
    sectionId: 'subagents',
    label: 'Vault subagents',
    type: { kind: 'custom', render: () => undefined },
    default: null,
  });

  r.registerField({
    id: 'providerConfigs.opencode.environmentVariables',
    tabId: 'opencode',
    sectionId: 'environment',
    label: 'Environment variables',
    description: 'KEY=value per line. Merged with shared env on launch.',
    type: { kind: 'textarea', rows: 6 },
    default: '',
  });
}
