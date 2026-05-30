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

  it("contains the general, agentBoard, and orchestrator tabs after D6 ports orchestrator", () => {
    expect(REGISTRY_TABS.has("general")).toBe(true);
    expect(REGISTRY_TABS.has("agentBoard")).toBe(true);
    expect(REGISTRY_TABS.has("orchestrator")).toBe(true);
  });

  it("useRegistryRenderer returns true for ported tabs", () => {
    expect(useRegistryRenderer("general")).toBe(true);
    expect(useRegistryRenderer("agentBoard")).toBe(true);
    expect(useRegistryRenderer("orchestrator")).toBe(true);
  });

  it("useRegistryRenderer returns false for any unported tab id", () => {
    expect(useRegistryRenderer("claude")).toBe(false);
    expect(useRegistryRenderer("codex")).toBe(false);
    expect(useRegistryRenderer("anyOtherTab")).toBe(false);
  });
});
