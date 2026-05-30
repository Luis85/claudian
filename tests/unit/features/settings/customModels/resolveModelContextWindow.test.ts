import type { ProviderChatUIConfig, ProviderUIOption } from '../../../../../src/core/providers/types';
import { resolveModelContextWindow } from '../../../../../src/features/settings/customModels/resolveModelContextWindow';

function makeUiConfig(
  options: ProviderUIOption[],
  fallbackContextWindow = 200_000,
): ProviderChatUIConfig {
  // Only the methods touched by resolveModelContextWindow need real behavior;
  // the rest are stubbed for the structural contract.
  return {
    getModelOptions: () => options,
    ownsModel: () => true,
    isAdaptiveReasoningModel: () => true,
    getReasoningOptions: () => [],
    getDefaultReasoningValue: () => '',
    getContextWindowSize: (model: string, customLimits?: Record<string, number>) => {
      return customLimits?.[model] ?? fallbackContextWindow;
    },
    isDefaultModel: () => false,
    applyModelDefaults: () => {},
    normalizeModelVariant: (model: string) => model,
    getCustomModelIds: () => new Set<string>(),
  };
}

describe('resolveModelContextWindow', () => {
  it('prefers the catalog option contextWindow when set', () => {
    const uiConfig = makeUiConfig([
      { value: 'custom-1', label: 'Custom', description: 'Custom', contextWindow: 500_000 },
    ]);
    const result = resolveModelContextWindow(uiConfig, {}, 'custom-1');
    expect(result).toBe(500_000);
  });

  it('falls back to uiConfig.getContextWindowSize when the option has no contextWindow', () => {
    const uiConfig = makeUiConfig([
      { value: 'custom-1', label: 'Custom', description: 'Custom' },
    ]);
    const result = resolveModelContextWindow(uiConfig, {}, 'custom-1');
    expect(result).toBe(200_000);
  });

  it('falls back to uiConfig.getContextWindowSize when the model is not in the catalog', () => {
    const uiConfig = makeUiConfig([
      { value: 'other', label: 'Other', description: 'Other', contextWindow: 999_000 },
    ]);
    const result = resolveModelContextWindow(uiConfig, {}, 'unknown');
    expect(result).toBe(200_000);
  });

  it('forwards customLimits to the fallback when the catalog does not carry contextWindow', () => {
    const uiConfig = makeUiConfig([
      { value: 'custom-1', label: 'Custom', description: 'Custom' },
    ]);
    const result = resolveModelContextWindow(uiConfig, {}, 'custom-1', {
      'custom-1': 300_000,
    });
    expect(result).toBe(300_000);
  });

  it('catalog contextWindow wins even when customLimits also has a value', () => {
    const uiConfig = makeUiConfig([
      { value: 'custom-1', label: 'Custom', description: 'Custom', contextWindow: 500_000 },
    ]);
    const result = resolveModelContextWindow(uiConfig, {}, 'custom-1', {
      'custom-1': 300_000,
    });
    expect(result).toBe(500_000);
  });
});
