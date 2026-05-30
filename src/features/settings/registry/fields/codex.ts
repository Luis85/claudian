import { CustomModelsTable } from '../../customModels/CustomModelsTable';
import { registerProviderTab } from '../providers/registerProviderTab';
import { getSettingsRegistry } from '../registry';

export function registerCodexTabFields(): void {
  const r = getSettingsRegistry();

  registerProviderTab(r, {
    providerId: 'codex',
    label: 'Codex',
    order: 20,
    sections: [
      { id: 'setup', label: 'Setup', order: 10 },
      { id: 'models', label: 'Models', order: 20 },
      { id: 'skills', label: 'Skills', order: 30 },
    ],
  });

  r.registerField({
    id: 'providerConfigs.codex.appServerPath',
    tabId: 'codex',
    sectionId: 'setup',
    label: 'App server path',
    description: 'Path to codex app-server executable',
    type: { kind: 'text', placeholder: '/usr/local/bin/codex' },
    default: '',
  });

  r.registerField({
    id: 'providerConfigs.codex.apiKey',
    tabId: 'codex',
    sectionId: 'setup',
    label: 'OpenAI API key',
    description: 'OpenAI API key for Codex requests',
    type: { kind: 'text', placeholder: 'sk-...' },
    default: '',
  });

  r.registerField({
    id: 'providerConfigs.codex.customModels',
    tabId: 'codex',
    sectionId: 'models',
    label: 'Custom models',
    description: 'Add custom model ids with optional aliases and context windows.',
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        const table = new CustomModelsTable(host, 'codex', ctx);
        table.render();
      },
    },
    default: null,
  });
}
