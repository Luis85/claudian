// Bootstraps provider registrations so ProviderRegistry.getChatUIConfig('opencode') resolves.
import '../../../../../../src/providers';

import { registerOpencodeTabFields } from '../../../../../../src/features/settings/registry/fields/opencode';
import { getSettingsRegistry, resetSettingsRegistryForTests } from '../../../../../../src/features/settings/registry/registry';
import { updateOpencodeProviderSettings } from '../../../../../../src/providers/opencode/settings';

const enabled = { providerConfigs: { opencode: { enabled: true } } } as any;

describe('Opencode tab registry fields', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('registers Opencode tab only when enabled', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const tabs = r.getTabs(enabled);
    expect(tabs.find((t) => t.id === 'opencode')).toBeDefined();

    const disabledTabs = r.getTabs({ providerConfigs: { opencode: { enabled: false } } } as any);
    expect(disabledTabs.find((t) => t.id === 'opencode')).toBeUndefined();
  });

  it('registers 5 sections under Opencode in spec order', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('opencode', enabled);
    expect(sections.map((s) => s.id)).toEqual([
      'setup',
      'models',
      'commands',
      'subagents',
      'environment',
    ]);
  });

  it('replaces the flat cliPath field with the hostname-keyed cliPathsByHost widget', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const setupIds = r.getFields('opencode', 'setup', enabled).map((f) => f.id);
    expect(setupIds).toContain('providerConfigs.opencode.cliPathsByHost');
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.opencode.cliPath')).toBeUndefined();
  });

  it('sources selectedMode dropdown options from the Opencode discovery state', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const settings = {
      providerConfigs: { opencode: { enabled: true } },
    } as any;
    updateOpencodeProviderSettings(settings, {
      availableModes: [
        { id: 'specorator-yolo', name: 'yolo', description: 'Default agent.' },
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
      { value: 'specorator-yolo', label: 'yolo' },
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

  it('registers the model widgets and workspace widgets as custom fields with keywords', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    const fields = r.getAllFields().filter((f) => f.tabId === 'opencode');
    const ids = fields.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([
      'providerConfigs.opencode.visibleModels',
      'providerConfigs.opencode.modelAliases',
      'providerConfigs.opencode.customModels',
      'hiddenProviderCommands.opencode',
      'opencode.subagents',
      'providerConfigs.opencode.environmentVariables',
    ]));

    for (const id of ids.filter((entry) => entry !== 'providerConfigs.opencode.selectedMode')) {
      const field = fields.find((f) => f.id === id);
      expect(field?.type.kind).toBe('custom');
    }
    for (const field of fields) {
      expect(field.keywords?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('does not register a providerConfigs.opencode.enabled field (lives on General tab)', () => {
    registerOpencodeTabFields();
    const r = getSettingsRegistry();
    expect(r.getAllFields().find((f) => f.id === 'providerConfigs.opencode.enabled')).toBeUndefined();
  });
});
