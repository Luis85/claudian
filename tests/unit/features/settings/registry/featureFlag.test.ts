import { USE_REGISTRY_RENDERER } from "../../../../../src/features/settings/registry/featureFlag";

describe("settings registry feature flag", () => {
  it("exposes a boolean USE_REGISTRY_RENDERER constant", () => {
    expect(typeof USE_REGISTRY_RENDERER).toBe("boolean");
  });

  it("defaults to false so production keeps the imperative shell", () => {
    expect(USE_REGISTRY_RENDERER).toBe(false);
  });
});
