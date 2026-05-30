import { registerProviderTab } from '../providers/registerProviderTab';
import { getSettingsRegistry } from '../registry';

export function registerClaudeTabFields(): void {
  const r = getSettingsRegistry();

  registerProviderTab(r, {
    providerId: 'claude',
    label: 'Claude',
    order: 10,
    sections: [
      { id: 'setup', label: 'Setup', order: 10 },
      { id: 'models', label: 'Models', order: 20 },
      { id: 'advanced', label: 'Advanced', order: 30 },
    ],
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
