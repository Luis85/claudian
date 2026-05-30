import {
  REGISTRY_TABS,
  USE_REGISTRY_RENDERER,
  useRegistryRenderer,
} from "../../../../../src/features/settings/registry/featureFlag";

describe("settings registry feature flag", () => {
  it("retains the legacy USE_REGISTRY_RENDERER boolean as false", () => {
    expect(typeof USE_REGISTRY_RENDERER).toBe("boolean");
    expect(USE_REGISTRY_RENDERER).toBe(false);
  });

  it("contains every settings tab after D5–D10 ports the remaining tabs", () => {
    expect(REGISTRY_TABS.has("general")).toBe(true);
    expect(REGISTRY_TABS.has("agentBoard")).toBe(true);
    expect(REGISTRY_TABS.has("orchestrator")).toBe(true);
    expect(REGISTRY_TABS.has("diagnostics")).toBe(true);
    expect(REGISTRY_TABS.has("claude")).toBe(true);
    expect(REGISTRY_TABS.has("codex")).toBe(true);
    expect(REGISTRY_TABS.has("opencode")).toBe(true);
    expect(REGISTRY_TABS.has("cursor")).toBe(true);
  });

  it("useRegistryRenderer returns true for every ported tab", () => {
    expect(useRegistryRenderer("general")).toBe(true);
    expect(useRegistryRenderer("agentBoard")).toBe(true);
    expect(useRegistryRenderer("orchestrator")).toBe(true);
    expect(useRegistryRenderer("diagnostics")).toBe(true);
    expect(useRegistryRenderer("claude")).toBe(true);
    expect(useRegistryRenderer("codex")).toBe(true);
    expect(useRegistryRenderer("opencode")).toBe(true);
    expect(useRegistryRenderer("cursor")).toBe(true);
  });

  it("useRegistryRenderer returns false for unknown tab ids", () => {
    expect(useRegistryRenderer("anyOtherTab")).toBe(false);
  });
});
