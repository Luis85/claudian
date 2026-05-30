import { getSettingsRegistry } from '../registry';

export function registerOrchestratorTabFields(): void {
  const r = getSettingsRegistry();

  r.registerTab({
    id: 'orchestrator',
    label: 'Orchestrator',
    order: 70,
    visible: () => true,
  });

  r.registerSection({
    id: 'enable',
    tabId: 'orchestrator',
    label: 'Enable',
    order: 10,
  });

  r.registerSection({
    id: 'prompt',
    tabId: 'orchestrator',
    label: 'Prompt',
    order: 20,
  });

  r.registerField({
    id: 'orchestratorEnabled',
    tabId: 'orchestrator',
    sectionId: 'enable',
    label: 'Enable orchestrator',
    type: { kind: 'toggle' },
    default: true,
  });

  r.registerField({
    id: 'orchestratorSystemPrompt',
    tabId: 'orchestrator',
    sectionId: 'prompt',
    label: 'System prompt',
    type: { kind: 'textarea', rows: 8 },
    default: '',
  });
}
