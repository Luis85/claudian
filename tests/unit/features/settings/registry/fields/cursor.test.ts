import { registerCursorTabFields } from '../../../../../../src/features/settings/registry/fields/cursor';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

const enabled = { providerConfigs: { cursor: { enabled: true } } } as any;

describe('Cursor tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers Cursor tab only when enabled', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs(enabled);
    expect(tabs.find((t) => t.id === 'cursor')).toBeDefined();

    const disabledTabs = r.getTabs({ providerConfigs: { cursor: { enabled: false } } } as any);
    expect(disabledTabs.find((t) => t.id === 'cursor')).toBeUndefined();
  });

  it('registers 2 sections under Cursor in spec order', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('cursor', enabled);
    expect(sections.map((s) => s.id)).toEqual(['models', 'environment']);
  });

  it('replaces the flat cliPath field with the hostname-keyed cliPathsByHost widget', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    const modelIds = r.getFields('cursor', 'models', enabled).map((f) => f.id);
    expect(modelIds).toContain('providerConfigs.cursor.cliPathsByHost');
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.cursor.cliPath')).toBeUndefined();
  });

  it('registers the family-grouped picker at the real persisted path', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    const all = r.getAllFields();
    const picker = all.find((f) => f.id === 'providerConfigs.cursor.enabledModelsByHost');
    expect(picker).toBeDefined();
    expect(picker?.type.kind).toBe('custom');
    // The old stub id (a settings path that never existed) must be gone.
    expect(all.find((f) => f.id === 'providerConfigs.cursor.enabledModels')).toBeUndefined();
  });

  it('does not register a modelAliases editor (Cursor persists no such setting)', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.cursor.modelAliases')).toBeUndefined();
  });

  it('registers providerConfigs.cursor.customModels and environment with keywords', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    const fields = r.getAllFields().filter((f) => f.tabId === 'cursor');
    const ids = fields.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([
      'providerConfigs.cursor.customModels',
      'providerConfigs.cursor.environmentVariables',
    ]));
    for (const field of fields) {
      expect(field.keywords?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('does not register a providerConfigs.cursor.enabled field (lives on General tab)', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.cursor.enabled')).toBeUndefined();
  });
});
