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

  it('registers appServerPath and apiKey fields in setup section', () => {
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('codex', 'setup', { providerConfigs: { codex: { enabled: true } } } as any);
    const ids = fields.map((f) => f.id);
    expect(ids).toContain('providerConfigs.codex.appServerPath');
    expect(ids).toContain('providerConfigs.codex.apiKey');
    const appServer = fields.find((f) => f.id === 'providerConfigs.codex.appServerPath');
    expect(appServer?.label).toBe('App server path');
    expect(appServer?.default).toBe('');
  });

  it('does not register a providerConfigs.codex.enabled field (lives on General tab)', () => {
    resetSettingsRegistryForTests();
    registerCodexTabFields();
    const r = getSettingsRegistry();
    const s = { providerConfigs: { codex: { enabled: true } } } as any;
    const allFields = r.getAllFields ? r.getAllFields() : [];
    expect(allFields.find((f: any) => f.id === 'providerConfigs.codex.enabled')).toBeUndefined();
    for (const section of r.getSections('codex', s)) {
      const fields = r.getFields('codex', section.id, s);
      expect(fields.find((f) => f.id === 'providerConfigs.codex.enabled')).toBeUndefined();
    }
  });
});
