import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { asSettingsBag, type SpecoratorSettings } from '../../core/types/settings';
import { resolveAgentBoardDefaultProvider } from './defaultProviderResolver';

/**
 * Resolves the Agent Board default model.
 *
 * Steps:
 *   1. Pick a provider via `resolveAgentBoardDefaultProvider`. If none, return null.
 *   2. If the stored `agentBoardDefaultModel` is owned by the resolved provider, return it.
 *   3. Otherwise fall back to the provider's first model option (its conventional default).
 *   4. If the provider has no models, return null.
 */
export function resolveAgentBoardDefaultModel(settings: SpecoratorSettings): string | null {
  const provider = resolveAgentBoardDefaultProvider(settings);
  if (!provider) return null;

  const settingsBag = asSettingsBag(settings);
  const config = ProviderRegistry.getChatUIConfig(provider);

  const stored = typeof settings.agentBoardDefaultModel === 'string'
    ? settings.agentBoardDefaultModel
    : '';
  if (stored && config.ownsModel(stored, settingsBag)) {
    return stored;
  }

  const options = config.getModelOptions(settingsBag);
  return options[0]?.value ?? null;
}
