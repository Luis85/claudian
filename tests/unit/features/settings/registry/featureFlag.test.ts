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

  it("starts with an empty REGISTRY_TABS set (no tabs ported in D3)", () => {
    expect(REGISTRY_TABS.size).toBe(0);
  });

  it("useRegistryRenderer returns false for the general tab until D4 flips it", () => {
    expect(useRegistryRenderer("general")).toBe(false);
  });

  it("useRegistryRenderer returns false for any unported tab id", () => {
    expect(useRegistryRenderer("claude")).toBe(false);
    expect(useRegistryRenderer("codex")).toBe(false);
    expect(useRegistryRenderer("agentBoard")).toBe(false);
    expect(useRegistryRenderer("anyOtherTab")).toBe(false);
  });
});
