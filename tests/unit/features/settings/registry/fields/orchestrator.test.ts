import { registerOrchestratorTabFields } from '../../../../../../src/features/settings/registry/fields/orchestrator';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

describe('Orchestrator tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers the Orchestrator tab as always visible', () => {
    registerOrchestratorTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: {} } as any);
    const tab = tabs.find((t) => t.id === 'orchestrator');
    expect(tab).toBeDefined();
    expect(tab?.label).toBe('Orchestrator');
    expect(tab?.order).toBe(70);
  });

  it('registers 2 sections under Orchestrator in spec order', () => {
    registerOrchestratorTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('orchestrator', { providerConfigs: {} } as any);
    expect(sections.map((s) => s.id)).toEqual(['enable', 'prompt']);
  });

  it('registers orchestratorEnabled in enable section with toggle kind and true default', () => {
    registerOrchestratorTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('orchestrator', 'enable', { providerConfigs: {} } as any);
    const enabled = fields.find((f) => f.id === 'orchestratorEnabled');
    expect(enabled).toBeDefined();
    expect(enabled?.label).toBe('Enable orchestrator');
    expect(enabled?.default).toBe(true);
    expect(enabled?.sectionId).toBe('enable');
    expect(enabled?.type.kind).toBe('toggle');
  });

  it('registers orchestratorSystemPrompt in prompt section as a textarea field', () => {
    registerOrchestratorTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('orchestrator', 'prompt', { providerConfigs: {} } as any);
    const prompt = fields.find((f) => f.id === 'orchestratorSystemPrompt');
    expect(prompt).toBeDefined();
    expect(prompt?.label).toBe('System prompt');
    expect(prompt?.default).toBe('');
    expect(prompt?.sectionId).toBe('prompt');
    expect(prompt?.type.kind).toBe('textarea');
  });
});
