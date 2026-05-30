import { registerOpencodeTabFields } from '../../../../../../src/features/settings/registry/fields/opencode';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

describe('Opencode tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers Opencode tab only when enabled', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: { opencode: { enabled: true } } } as any);
    expect(tabs.find((t) => t.id === 'opencode')).toBeDefined();

    const disabledTabs = r.getTabs({ providerConfigs: { opencode: { enabled: false } } } as any);
    expect(disabledTabs.find((t) => t.id === 'opencode')).toBeUndefined();
  });

  it('registers 5 sections under Opencode in spec order', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('opencode', { providerConfigs: { opencode: { enabled: true } } } as any);
    expect(sections.map((s) => s.id)).toEqual([
      'setup',
      'models',
      'commands',
      'subagents',
      'environment',
    ]);
  });

  it('registers cliPath field in setup section with default ""', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('opencode', 'setup', { providerConfigs: { opencode: { enabled: true } } } as any);
    const cliPath = fields.find((f) => f.id === 'providerConfigs.opencode.cliPath');
    expect(cliPath).toBeDefined();
    expect(cliPath?.label).toBe('CLI path');
    expect(cliPath?.default).toBe('');
  });
});
