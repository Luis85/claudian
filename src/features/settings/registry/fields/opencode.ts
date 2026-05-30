import type { ClaudianSettings } from '../../../../core/types/settings';
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
      options: (settings: ClaudianSettings) => {
        const opencode = (settings.providerConfigs?.opencode ?? {}) as Record<string, unknown>;
        const discovered = (opencode.discoveredModes ?? []) as Array<{ id?: string; name?: string }>;
        return discovered
          .filter((mode) => typeof mode.id === 'string' && mode.id.length > 0)
          .map((mode) => ({ value: mode.id as string, label: mode.name ?? (mode.id as string) }));
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
