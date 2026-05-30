// Tabs whose imperative renderer has been replaced by the registry walker.
// D4 flips `general` on; D5–D10 port the remaining tabs. The legacy
// `USE_REGISTRY_RENDERER` boolean is retained for backward compatibility and
// removed in Phase J once every tab is on the registry.
export const REGISTRY_TABS: ReadonlySet<string> = new Set<string>([
  'general',
  'agentBoard',
  'orchestrator',
  'diagnostics',
  'claude',
  'codex',
  'opencode',
  'cursor',
]);

export function useRegistryRenderer(tabId: string): boolean {
  return REGISTRY_TABS.has(tabId);
}

export const USE_REGISTRY_RENDERER = false;
