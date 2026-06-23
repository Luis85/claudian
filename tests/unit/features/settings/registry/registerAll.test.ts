import type { SpecoratorSettings } from '../../../../../src/core/types/settings';
import { registerAllSettings } from '../../../../../src/features/settings/registry/registerAll';
import {
  getSettingsRegistry,
  resetSettingsRegistryForTests,
} from '../../../../../src/features/settings/registry/registry';

function settings(allEnabled: boolean): SpecoratorSettings {
  return {
    providerConfigs: {
      claude: { enabled: allEnabled },
      codex: { enabled: allEnabled },
      opencode: { enabled: allEnabled },
      cursor: { enabled: allEnabled },
    },
  } as unknown as SpecoratorSettings;
}

describe('registerAllSettings', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('does not register removed parallel-run settings', () => {
    const removedTabId = ['orch', 'estrator'].join('');

    registerAllSettings();
    const registry = getSettingsRegistry();
    expect(registry.getTabs(settings(false)).map((tab) => tab.id)).not.toContain(
      removedTabId
    );
    expect(registry.getAllFields().map((field) => field.id)).not.toContain(
      `${removedTabId}Enabled`
    );
    expect(registry.getAllFields().map((field) => field.id)).not.toContain(
      `${removedTabId}SystemPrompt`
    );
  });

  it('produces all 8 tabs when every provider is enabled', () => {
    registerAllSettings();
    const tabs = getSettingsRegistry()
      .getTabs(settings(true))
      .map((t) => t.id);
    expect(tabs).toEqual([
      'general',
      'claude',
      'codex',
      'opencode',
      'cursor',
      'agentBoard',
      'diagnostics',
    ]);
  });

  it('throws on a second invocation because tab ids collide', () => {
    registerAllSettings();
    expect(() => registerAllSettings()).toThrow(/duplicate tab id/);
  });
});

