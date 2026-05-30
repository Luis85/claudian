import { CustomModelsTable } from '../../customModels/CustomModelsTable';
import { registerProviderTab } from '../providers/registerProviderTab';
import { getSettingsRegistry } from '../registry';

export function registerCursorTabFields(): void {
  const r = getSettingsRegistry();

  registerProviderTab(r, {
    providerId: 'cursor',
    label: 'Cursor',
    order: 50,
    sections: [
      { id: 'models', label: 'Models', order: 10 },
      { id: 'environment', label: 'Environment', order: 20 },
    ],
  });

  r.registerField({
    id: 'providerConfigs.cursor.cliPath',
    tabId: 'cursor',
    sectionId: 'models',
    label: 'CLI path',
    description: 'Path to cursor-agent CLI executable',
    type: { kind: 'text', placeholder: '/usr/local/bin/cursor-agent' },
    default: '',
  });

  r.registerField({
    id: 'providerConfigs.cursor.enabledModels',
    tabId: 'cursor',
    sectionId: 'models',
    label: 'Enabled models',
    type: { kind: 'custom', render: () => undefined },
    default: null,
  });

  r.registerField({
    id: 'providerConfigs.cursor.modelAliases',
    tabId: 'cursor',
    sectionId: 'models',
    label: 'Model aliases',
    type: { kind: 'custom', render: () => undefined },
    default: null,
  });

  r.registerField({
    id: 'providerConfigs.cursor.customModels',
    tabId: 'cursor',
    sectionId: 'models',
    label: 'Custom models',
    description: 'Add custom model ids with optional aliases and context windows.',
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        const table = new CustomModelsTable(host, 'cursor', ctx);
        table.render();
      },
    },
    default: null,
  });

  r.registerField({
    id: 'providerConfigs.cursor.environmentVariables',
    tabId: 'cursor',
    sectionId: 'environment',
    label: 'Environment variables',
    description: 'KEY=value per line. Merged with shared env on launch.',
    type: { kind: 'textarea', rows: 6 },
    default: '',
  });
}
