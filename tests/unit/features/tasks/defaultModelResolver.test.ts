import type { ProviderId } from '../../../../src/core/providers/types';
import type { SpecoratorSettings } from '../../../../src/core/types/settings';

jest.mock('../../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getChatUIConfig: jest.fn(),
    getRegisteredProviderIds: jest.fn().mockReturnValue(['claude', 'codex', 'opencode', 'cursor']),
  },
}));

import { ProviderRegistry } from '../../../../src/core/providers/ProviderRegistry';
import { resolveAgentBoardDefaultModel } from '../../../../src/features/tasks/defaultModelResolver';

const getChatUIConfig = ProviderRegistry.getChatUIConfig as jest.Mock;

function settings(
  enabled: ProviderId[],
  storedProvider: ProviderId | null = null,
  storedModel: string | null = null,
): SpecoratorSettings {
  const provs = ['claude', 'codex', 'opencode', 'cursor'] as ProviderId[];
  return {
    agentBoardDefaultProvider: storedProvider,
    agentBoardDefaultModel: storedModel,
    providerConfigs: Object.fromEntries(
      provs.map((id) => [id, { enabled: enabled.includes(id) }]),
    ),
  } as unknown as SpecoratorSettings;
}

describe('resolveAgentBoardDefaultModel', () => {
  beforeEach(() => {
    getChatUIConfig.mockReset();
  });

  it('returns null when no provider can be resolved', () => {
    expect(resolveAgentBoardDefaultModel(settings([]))).toBeNull();
    expect(getChatUIConfig).not.toHaveBeenCalled();
  });

  it('returns stored model if valid for the resolved provider', () => {
    getChatUIConfig.mockReturnValue({
      ownsModel: (m: string) => m === 'sonnet',
      getModelOptions: () => [{ value: 'sonnet', label: 'Sonnet' }],
    });
    const result = resolveAgentBoardDefaultModel(settings(['claude'], 'claude', 'sonnet'));
    expect(result).toBe('sonnet');
  });

  it('falls back to provider default when stored model is invalid', () => {
    getChatUIConfig.mockReturnValue({
      ownsModel: (m: string) => m === 'haiku' || m === 'sonnet',
      getModelOptions: () => [
        { value: 'haiku', label: 'Haiku' },
        { value: 'sonnet', label: 'Sonnet' },
      ],
    });
    const result = resolveAgentBoardDefaultModel(settings(['claude'], 'claude', 'gpt-4'));
    expect(result).toBe('haiku');
  });

  it('falls back to provider default when stored model is empty', () => {
    getChatUIConfig.mockReturnValue({
      ownsModel: () => false,
      getModelOptions: () => [{ value: 'haiku', label: 'Haiku' }],
    });
    const result = resolveAgentBoardDefaultModel(settings(['claude'], 'claude', ''));
    expect(result).toBe('haiku');
  });

  it('falls back to provider default when stored model is null', () => {
    getChatUIConfig.mockReturnValue({
      ownsModel: () => false,
      getModelOptions: () => [{ value: 'haiku', label: 'Haiku' }],
    });
    const result = resolveAgentBoardDefaultModel(settings(['claude'], 'claude', null));
    expect(result).toBe('haiku');
  });

  it('returns null when stored is invalid AND provider has no models', () => {
    getChatUIConfig.mockReturnValue({
      ownsModel: () => false,
      getModelOptions: () => [],
    });
    const result = resolveAgentBoardDefaultModel(settings(['claude'], 'claude', 'gpt-4'));
    expect(result).toBeNull();
  });

  it('uses the resolved provider when stored provider is disabled', () => {
    // Stored provider codex is disabled; resolver should pick claude (first enabled in order).
    // Model "sonnet" is valid for claude.
    getChatUIConfig.mockImplementation((id: ProviderId) => {
      if (id === 'claude') {
        return {
          ownsModel: (m: string) => m === 'sonnet',
          getModelOptions: () => [{ value: 'sonnet', label: 'Sonnet' }],
        };
      }
      return { ownsModel: () => false, getModelOptions: () => [] };
    });
    const result = resolveAgentBoardDefaultModel(settings(['claude'], 'codex', 'sonnet'));
    expect(result).toBe('sonnet');
    expect(getChatUIConfig).toHaveBeenCalledWith('claude');
  });
});
