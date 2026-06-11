// Bootstraps provider registrations so ProviderRegistry queries resolve.
import '../../../../../../src/providers';

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

  it('registers 8 sections under General, mirroring the legacy renderer', () => {
    registerGeneralTabFields();
    const r = getSettingsRegistry();
    const sections = r.getSections('general', { providerConfigs: {} } as any);
    expect(sections.length).toBe(8);
    expect(sections.map((s) => s.id)).toEqual([
      'providers',
      'general',
      'display',
      'conversations',
      'content',
      'input',
      'hotkeys',
      'environment',
    ]);
  });

  it('registers the Show setup again button-field', async () => {
    registerGeneralTabFields();
    const r = getSettingsRegistry();
    const fields = r.getFields('general', 'providers', { providerConfigs: {} } as any);
    const field = fields.find((f) => f.id === 'general.providers.showSetupAgain');
    expect(field).toBeDefined();
    expect(field?.type.kind).toBe('button');
  });

  it('Show setup again onClick clears firstRunDismissed and saves+refreshes', async () => {
    registerGeneralTabFields();
    const r = getSettingsRegistry();
    const field = r
      .getFields('general', 'providers', { providerConfigs: {} } as any)
      .find((f) => f.id === 'general.providers.showSetupAgain');
    expect(field).toBeDefined();
    const fieldType = field!.type as {
      kind: 'button';
      label: string;
      onClick: (ctx: any) => Promise<void>;
    };
    expect(fieldType.kind).toBe('button');
    const save = jest.fn().mockResolvedValue(undefined);
    const refresh = jest.fn();
    const ctx = { settings: { firstRunDismissed: true } as any, saveSettings: save, refresh };
    await fieldType.onClick(ctx);
    expect(ctx.settings.firstRunDismissed).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  describe('provider enable rows in General > Providers section', () => {
    const providers = ['claude', 'codex', 'opencode', 'cursor'] as const;

    // Ported as `custom` (not bare toggles): the rows mount
    // renderProviderEnableSetting so enabling a provider also reveals its
    // settings tab, matching the legacy renderer's behavior.
    it.each(providers)('registers providerConfigs.%s.enabled row', (id) => {
      resetSettingsRegistryForTests();
      registerGeneralTabFields();
      const r = getSettingsRegistry();
      const fields = r.getFields('general', 'providers', { providerConfigs: {} } as any);
      const field = fields.find((f) => f.id === `providerConfigs.${id}.enabled`);
      expect(field).toBeDefined();
      expect(field?.type.kind).toBe('custom');
    });
  });
});
