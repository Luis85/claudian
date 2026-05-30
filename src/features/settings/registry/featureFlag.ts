// Tabs whose imperative renderer has been replaced by the registry walker.
// Empty for now; D4 flips `general` on and D5–D10 port the remaining tabs.
// The legacy `USE_REGISTRY_RENDERER` boolean is retained for backward
// compatibility and removed in Phase J once every tab is on the registry.
export const REGISTRY_TABS: ReadonlySet<string> = new Set<string>();

export function useRegistryRenderer(tabId: string): boolean {
  return REGISTRY_TABS.has(tabId);
}

export const USE_REGISTRY_RENDERER = false;
