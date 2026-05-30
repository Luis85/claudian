import type { ClaudianSettings } from '../../../../../../src/core/types/settings';
import { registerProviderTab } from '../../../../../../src/features/settings/registry/providers/registerProviderTab';
import { SettingsRegistry } from '../../../../../../src/features/settings/registry/SettingsRegistry';

function settingsWith(enabled: boolean): ClaudianSettings {
  return {
    providerConfigs: { claude: { enabled } },
  } as unknown as ClaudianSettings;
}

describe('registerProviderTab', () => {
  it('hides the tab when the provider is disabled', () => {
    const r = new SettingsRegistry();
    registerProviderTab(r, {
      providerId: 'claude',
      label: 'Claude',
      order: 20,
      sections: [{ id: 'setup', label: 'Setup', order: 10 }],
    });
    expect(r.getTabs(settingsWith(false)).map((t) => t.id)).not.toContain('claude');
  });

  it('shows the tab and its sections when enabled', () => {
    const r = new SettingsRegistry();
    registerProviderTab(r, {
      providerId: 'claude',
      label: 'Claude',
      order: 20,
      sections: [
        { id: 'setup', label: 'Setup', order: 10 },
        { id: 'models', label: 'Models', order: 20 },
      ],
    });
    expect(r.getTabs(settingsWith(true)).map((t) => t.id)).toContain('claude');
    expect(r.getSections('claude', settingsWith(true)).map((s) => s.id)).toEqual([
      'setup',
      'models',
    ]);
  });
});
