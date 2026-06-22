import type { ProviderId } from '../../../../../src/core/providers/types';
import {
  agentPreferredProviderId,
  resolveAgentProvider,
} from '../../../../../src/features/agents/roster/resolveAgentProvider';

const claude = 'claude' as ProviderId;
const cursor = 'cursor' as ProviderId;
const codex = 'codex' as ProviderId;

describe('agentPreferredProviderId', () => {
  it('prefers an explicit providerOverride over the model selection', () => {
    expect(
      agentPreferredProviderId({
        providerOverride: cursor,
        modelSelection: { modelId: 'm', providerId: claude },
      }),
    ).toBe(cursor);
  });

  it('falls back to the model selection provider when there is no override', () => {
    expect(
      agentPreferredProviderId({
        providerOverride: undefined,
        modelSelection: { modelId: 'm', providerId: claude },
      }),
    ).toBe(claude);
  });

  it('returns undefined when neither is set', () => {
    expect(agentPreferredProviderId({ providerOverride: undefined, modelSelection: undefined })).toBeUndefined();
  });
});

describe('resolveAgentProvider', () => {
  const fallback = codex;

  it('returns the preferred provider when it is set and enabled', () => {
    const resolved = resolveAgentProvider(
      { providerOverride: cursor, modelSelection: undefined },
      (p) => p === cursor,
      fallback,
    );
    expect(resolved).toBe(cursor);
  });

  it('returns the fallback when the preferred provider is disabled', () => {
    const resolved = resolveAgentProvider(
      { providerOverride: cursor, modelSelection: undefined },
      () => false,
      fallback,
    );
    expect(resolved).toBe(fallback);
  });

  it('returns the fallback when there is no preference', () => {
    const resolved = resolveAgentProvider(
      { providerOverride: undefined, modelSelection: undefined },
      () => true,
      fallback,
    );
    expect(resolved).toBe(fallback);
  });

  it('derives the preferred provider from the model selection when no override is set', () => {
    const resolved = resolveAgentProvider(
      { providerOverride: undefined, modelSelection: { modelId: 'm', providerId: claude } },
      (p) => p === claude,
      fallback,
    );
    expect(resolved).toBe(claude);
  });
});
