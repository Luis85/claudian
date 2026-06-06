// Tabs whose imperative renderer has been replaced by the registry walker.
// Only tabs whose registry registration is FEATURE-COMPLETE belong here.
// Incomplete tabs (general, claude, codex, opencode, cursor) fall back to the
// legacy imperative renderer until their registry port matches the legacy UI.
//
// Audit (2026-05-31):
//   - general: 30+ fields missing (locale, display, conversations, content, input, env)
//   - claude: 10+ fields missing (loadUserSettings, model toggles, env, mcp/plugins widgets)
//   - codex: 8+ fields missing (safeMode, installMethod, reasoningSummary, env, etc.)
//   - opencode: visibleModels/modelAliases custom widgets still placeholders
//   - cursor: visibleModels custom widget still placeholder
//   - agentBoard, diagnostics: COMPLETE — keep on registry
export const REGISTRY_TABS: ReadonlySet<string> = new Set<string>([
  'agentBoard',
  'diagnostics',
]);

export function useRegistryRenderer(tabId: string): boolean {
  return REGISTRY_TABS.has(tabId);
}

export const USE_REGISTRY_RENDERER = false;
