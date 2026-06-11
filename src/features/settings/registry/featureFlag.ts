import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';

// Tabs whose imperative renderer has been replaced by the registry walker.
// Only tabs whose registry registration is FEATURE-COMPLETE belongs here.
//
// 2026-06-11: all seven tabs render through the registry, each flipped in the
// same change as its passing parity test (tests/integration/settings/
// <tab>Port.test.ts asserts the legacy field inventory renders through the
// registry walker). The legacy renderers and provider settingsTabRenderer
// wiring stay in place as fallback until the v4.0.0 deletion pass, gated on
// manual vault verification (fresh vault + existing vault) — see
// docs/issues/settings-registry-port-followup.md and
// docs/superpowers/plans/2026-06-11-settings-registry-port-completion.md.
const STATIC_REGISTRY_TABS: ReadonlySet<string> = new Set<string>([
  'general',
  'agentBoard',
  'diagnostics',
]);

// Provider tab ids come from the registry at call time (not import time, so
// provider bootstrap order can't race this module) — registering a new
// provider is the only step (guarded by noHardcodedProviderList.test.ts);
// its fields module must register the tab as feature-complete before
// shipping.
export function getRegistryTabIds(): ReadonlySet<string> {
  return new Set<string>([
    ...STATIC_REGISTRY_TABS,
    ...ProviderRegistry.getRegisteredProviderIds(),
  ]);
}

export function useRegistryRenderer(tabId: string): boolean {
  if (STATIC_REGISTRY_TABS.has(tabId)) return true;
  return ProviderRegistry.getRegisteredProviderIds().includes(tabId);
}
