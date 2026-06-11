// Bootstraps provider registrations so ProviderRegistry queries resolve.
import '../../../../../src/providers';

import {
  getRegistryTabIds,
  useRegistryRenderer,
} from '@/features/settings/registry/featureFlag';

describe('settings featureFlag', () => {
  it('exposes registry tab ids derived from the provider registry', () => {
    expect(Array.from(getRegistryTabIds()).sort()).toEqual([
      'agentBoard',
      'claude',
      'codex',
      'cursor',
      'diagnostics',
      'general',
      'opencode',
    ]);
  });

  it('does not registry-render removed parallel-run settings', () => {
    const removedTabId = ['orch', 'estrator'].join('');

    expect(useRegistryRenderer('agentBoard')).toBe(true);
    expect(useRegistryRenderer('diagnostics')).toBe(true);
    expect(useRegistryRenderer(removedTabId)).toBe(false);
  });

  it('registry-renders every ported tab', () => {
    expect(useRegistryRenderer('general')).toBe(true);
    expect(useRegistryRenderer('claude')).toBe(true);
    expect(useRegistryRenderer('codex')).toBe(true);
    expect(useRegistryRenderer('opencode')).toBe(true);
    expect(useRegistryRenderer('cursor')).toBe(true);
  });

  it('returns false for unknown tab ids', () => {
    expect(useRegistryRenderer('does-not-exist')).toBe(false);
    expect(useRegistryRenderer('')).toBe(false);
  });
});
