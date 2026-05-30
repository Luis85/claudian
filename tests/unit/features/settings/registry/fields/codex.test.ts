import { registerCodexTabFields } from '../../../../../../src/features/settings/registry/fields/codex';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

describe('Codex tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers Codex tab only when enabled', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: { codex: { enabled: true } } } as any);
    expect(tabs.find((t) => t.id === 'codex')).toBeDefined();

    const disabledTabs = r.getTabs({ providerConfigs: { codex: { enabled: false } } } as any);
    expect(disabledTabs.find((t) => t.id === 'codex')).toBeUndefined();
  });

  it('registers 3 sections under Codex', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('codex', { providerConfigs: { codex: { enabled: true } } } as any);
    expect(sections.map((s) => s.id)).toEqual(['setup', 'models', 'skills']);
  });
});
