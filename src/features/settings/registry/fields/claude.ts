import type { ClaudianSettings } from '../../../../core/types/settings';
import { getSettingsRegistry } from '../registry';

export function registerClaudeTabFields(): void {
  const r = getSettingsRegistry();

  r.registerTab({
    id: 'claude',
    label: 'Claude',
    order: 10,
    visible: (s: ClaudianSettings): boolean => (s.providerConfigs?.claude?.enabled as boolean) ?? false,
  });

  r.registerSection({
    id: 'setup',
    tabId: 'claude',
    label: 'Setup',
    order: 10,
  });

  r.registerSection({
    id: 'models',
    tabId: 'claude',
    label: 'Models',
    order: 20,
  });

  r.registerSection({
    id: 'advanced',
    tabId: 'claude',
    label: 'Advanced',
    order: 30,
  });

  r.registerField({
    id: 'providerConfigs.claude.cliPath',
    tabId: 'claude',
    sectionId: 'setup',
    label: 'CLI path',
    description: 'Path to claude CLI executable',
    type: { kind: 'text', placeholder: '/usr/local/bin/claude' },
    default: '',
  });

  r.registerField({
    id: 'providerConfigs.claude.safeMode',
    tabId: 'claude',
    sectionId: 'setup',
    label: 'Safe mode',
    description: 'Approval mode for tool execution',
    type: {
      kind: 'dropdown',
      options: () => [
        { value: 'acceptEdits', label: 'Accept edits' },
        { value: 'requireApproval', label: 'Require approval' },
        { value: 'sandbox', label: 'Sandbox' },
      ],
    },
    default: 'acceptEdits',
  });
}
