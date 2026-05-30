import { registerGeneralTabFields } from '../../../../../../src/features/settings/registry/fields/general';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';

describe('General tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers the General tab', () => {
    registerGeneralTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs({ providerConfigs: {} } as any);
    expect(tabs.find((t) => t.id === 'general')).toBeDefined();
  });

  it('registers 8 sections under General', () => {
    registerGeneralTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('general', { providerConfigs: {} } as any);
    expect(sections.length).toBe(8);
    expect(sections.map((s) => s.id)).toEqual([
      'providers',
      'appearance',
      'chat',
      'inlineEdit',
      'agentMentions',
      'performance',
      'diagnostics',
      'hotkeys',
    ]);
  });
});
