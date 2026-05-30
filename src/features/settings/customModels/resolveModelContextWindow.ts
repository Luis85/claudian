import type { ProviderChatUIConfig } from '../../../core/providers/types';

/**
 * Resolve the context-window size for a model by preferring the provider catalog
 * option's `contextWindow` (set from a customModels row) before falling back to
 * the provider's built-in `getContextWindowSize`. Built-in defaults still flow
 * through `uiConfig.getContextWindowSize`; the legacy `customLimits` map is also
 * forwarded so transitional callsites keep working until that path is retired.
 */
export function resolveModelContextWindow(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  model: string,
  customLimits?: Record<string, number>,
): number {
  const option = uiConfig.getModelOptions(settings).find((entry) => entry.value === model);
  if (option?.contextWindow !== undefined) {
    return option.contextWindow;
  }
  return uiConfig.getContextWindowSize(model, customLimits);
}
