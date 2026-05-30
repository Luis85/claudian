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

  it("contains exactly the general tab after D4 ports it", () => {
    expect(REGISTRY_TABS.size).toBe(1);
    expect(REGISTRY_TABS.has("general")).toBe(true);
  });

  it("useRegistryRenderer returns true for the general tab now that D4 flipped it", () => {
    expect(useRegistryRenderer("general")).toBe(true);
  });

  it("useRegistryRenderer returns false for any unported tab id", () => {
    expect(useRegistryRenderer("claude")).toBe(false);
    expect(useRegistryRenderer("codex")).toBe(false);
    expect(useRegistryRenderer("agentBoard")).toBe(false);
    expect(useRegistryRenderer("anyOtherTab")).toBe(false);
  });
});
