import type { ClaudianSettings } from '../../../../../src/core/types/settings';
import { registerAllSettings } from '../../../../../src/features/settings/registry/registerAll';
import {
  getSettingsRegistry,
  resetSettingsRegistryForTests,
} from '../../../../../src/features/settings/registry/registry';

function settings(allEnabled: boolean): ClaudianSettings {
  return {
    providerConfigs: {
      claude: { enabled: allEnabled },
      codex: { enabled: allEnabled },
      opencode: { enabled: allEnabled },
      cursor: { enabled: allEnabled },
    },
  } as unknown as ClaudianSettings;
}

describe('registerAllSettings', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('produces general, agentBoard, orchestrator, diagnostics tabs by default', () => {
    registerAllSettings();
    const tabs = getSettingsRegistry()
      .getTabs(settings(false))
      .map((t) => t.id);
    expect(tabs).toEqual(['general', 'agentBoard', 'orchestrator', 'diagnostics']);
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
      'orchestrator',
      'diagnostics',
    ]);
  });

  it('throws on a second invocation because tab ids collide', () => {
    registerAllSettings();
    expect(() => registerAllSettings()).toThrow(/duplicate tab id/);
  });
});
