import type { ProviderId } from '../../../../../src/core/providers/types';
import {
  agentPreferredProviderId,
  resolveAgentModelForProvider,
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

describe('resolveAgentModelForProvider', () => {
  it('uses the agent model when its selection provider matches the resolved provider', () => {
    expect(
      resolveAgentModelForProvider(
        { modelSelection: { modelId: 'gpt-5-codex', providerId: codex } },
        codex,
        'default-codex',
      ),
    ).toBe('gpt-5-codex');
  });

  it('falls back to the provider default when the selection targets a different provider', () => {
    // The agent's saved model belongs to a now-disabled provider, so the run
    // fell back to `cursor`; the codex model id must NOT leak to cursor.
    expect(
      resolveAgentModelForProvider(
        { modelSelection: { modelId: 'gpt-5-codex', providerId: codex } },
        cursor,
        'auto',
      ),
    ).toBe('auto');
  });

  it('returns the provider default when there is no model selection', () => {
    expect(
      resolveAgentModelForProvider({ modelSelection: undefined }, claude, 'opus'),
    ).toBe('opus');
  });

  it('returns undefined when there is no selection and no provider default', () => {
    expect(
      resolveAgentModelForProvider({ modelSelection: undefined }, claude, undefined),
    ).toBeUndefined();
  });
});
