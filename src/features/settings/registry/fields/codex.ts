import type { ClaudianSettings } from '../../../../core/types/settings';
import { getSettingsRegistry } from '../registry';

export function registerCodexTabFields(): void {
  const r = getSettingsRegistry();

  r.registerTab({
    id: 'codex',
    label: 'Codex',
    order: 20,
    visible: (s: ClaudianSettings): boolean => (s.providerConfigs?.codex?.enabled as boolean) ?? false,
  });

  r.registerSection({
    id: 'setup',
    tabId: 'codex',
    label: 'Setup',
    order: 10,
  });

  r.registerSection({
    id: 'models',
    tabId: 'codex',
    label: 'Models',
    order: 20,
  });

  r.registerSection({
    id: 'skills',
    tabId: 'codex',
    label: 'Skills',
    order: 30,
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
}
