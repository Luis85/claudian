import { registerClaudeTabFields } from '../../../../../../src/features/settings/registry/fields/claude';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

describe('Claude tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers Claude tab only when enabled', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: { claude: { enabled: true } } } as any);
    expect(tabs.find((t) => t.id === 'claude')).toBeDefined();

    const disabledTabs = r.getTabs({ providerConfigs: { claude: { enabled: false } } } as any);
    expect(disabledTabs.find((t) => t.id === 'claude')).toBeUndefined();
  });

  it('registers 3 sections under Claude', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('claude', { providerConfigs: { claude: { enabled: true } } } as any);
    expect(sections.length).toBe(3);
    expect(sections.map((s) => s.id)).toEqual(['setup', 'models', 'advanced']);
  });

  it('registers fields in setup section', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('claude', 'setup', { providerConfigs: { claude: { enabled: true } } } as any);
    expect(fields.map((f) => f.id)).toContain('providerConfigs.claude.cliPath');
    expect(fields.map((f) => f.id)).toContain('providerConfigs.claude.safeMode');
  });

  it('registers providerConfigs.claude.customModels under models', () => {
    registerClaudeTabFields();
    const r = getSettingsRegistry();
    const s = { providerConfigs: { claude: { enabled: true } } } as any;
    const field = r
      .getFields('claude', 'models', s)
      .find((f) => f.id === 'providerConfigs.claude.customModels');
    expect(field).toBeDefined();
    expect(field?.type.kind).toBe('custom');
  });
});
