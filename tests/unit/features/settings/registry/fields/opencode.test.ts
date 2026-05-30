import { registerOpencodeTabFields } from '../../../../../../src/features/settings/registry/fields/opencode';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';
import { updateOpencodeProviderSettings } from '../../../../../../src/providers/opencode/settings';

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

  it('sources selectedMode dropdown options from the Opencode discovery state', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const settings = {
      providerConfigs: { opencode: { enabled: true } },
    } as any;
    updateOpencodeProviderSettings(settings, {
      availableModes: [
        { id: 'claudian-yolo', name: 'yolo', description: 'Default agent.' },
        { id: 'plan', name: 'plan', description: 'Plan mode.' },
      ],
    });
    const fields = r.getFields('opencode', 'models', settings);
    const selectedMode = fields.find((f) => f.id === 'providerConfigs.opencode.selectedMode');
    expect(selectedMode).toBeDefined();
    const type = selectedMode!.type;
    if (type.kind !== 'dropdown') {
      throw new Error('selectedMode type must be dropdown');
    }
    expect(type.options(settings)).toEqual([
      { value: 'claudian-yolo', label: 'yolo' },
      { value: 'plan', label: 'plan' },
    ]);
  });

  it('returns no selectedMode options when availableModes is empty or missing', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const settings = {
      providerConfigs: { opencode: { enabled: true } },
    } as any;
    const fields = r.getFields('opencode', 'models', settings);
    const selectedMode = fields.find((f) => f.id === 'providerConfigs.opencode.selectedMode');
    const type = selectedMode!.type;
    if (type.kind !== 'dropdown') {
      throw new Error('selectedMode type must be dropdown');
    }
    expect(type.options(settings)).toEqual([]);
  });
});
