import { registerCursorTabFields } from '../../../../../../src/features/settings/registry/fields/cursor';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

describe('Cursor tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers Cursor tab only when enabled', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: { cursor: { enabled: true } } } as any);
    expect(tabs.find((t) => t.id === 'cursor')).toBeDefined();

    const disabledTabs = r.getTabs({ providerConfigs: { cursor: { enabled: false } } } as any);
    expect(disabledTabs.find((t) => t.id === 'cursor')).toBeUndefined();
  });

  it('registers 2 sections under Cursor in spec order', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('cursor', { providerConfigs: { cursor: { enabled: true } } } as any);
    expect(sections.map((s) => s.id)).toEqual(['models', 'environment']);
  });

  it('registers cliPath field in models section with default ""', () => {
    registerCursorTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('cursor', 'models', { providerConfigs: { cursor: { enabled: true } } } as any);
    const cliPath = fields.find((f) => f.id === 'providerConfigs.cursor.cliPath');
    expect(cliPath).toBeDefined();
    expect(cliPath?.label).toBe('CLI path');
    expect(cliPath?.default).toBe('');
  });
});
