import {
  REGISTRY_TABS,
  USE_REGISTRY_RENDERER,
  useRegistryRenderer,
} from '@/features/settings/registry/featureFlag';

describe('settings featureFlag', () => {
  it('exposes a readonly set of registry tabs', () => {
    expect(REGISTRY_TABS).toBeInstanceOf(Set);
    expect(REGISTRY_TABS.size).toBeGreaterThan(0);
  });

  it('does not registry-render Orchestrator settings', () => {
    expect(useRegistryRenderer('agentBoard')).toBe(true);
    expect(useRegistryRenderer('diagnostics')).toBe(true);
    expect(useRegistryRenderer('orchestrator')).toBe(false);
  });

  it('falls back to legacy for tabs whose registry port is incomplete', () => {
    expect(useRegistryRenderer('general')).toBe(false);
    expect(useRegistryRenderer('claude')).toBe(false);
    expect(useRegistryRenderer('codex')).toBe(false);
    expect(useRegistryRenderer('opencode')).toBe(false);
    expect(useRegistryRenderer('cursor')).toBe(false);
  });

  it('returns false for unknown tab ids', () => {
    expect(useRegistryRenderer('does-not-exist')).toBe(false);
    expect(useRegistryRenderer('')).toBe(false);
  });

  it('keeps legacy USE_REGISTRY_RENDERER boolean off (back-compat)', () => {
    expect(USE_REGISTRY_RENDERER).toBe(false);
  });
});
