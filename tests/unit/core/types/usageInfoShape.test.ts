import type { UsageInfo } from '../../../../src/core/types';

describe('UsageInfo shape (compile-time)', () => {
  it('accepts the extended fields without losing the existing ones', () => {
    const sample: UsageInfo = {
      model: 'claude-sonnet-4',
      inputTokens: 100,
      outputTokens: 50,
      reasoningOutputTokens: 10,
      thoughtTokens: 5,
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 30,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      contextTokens: 150,
      percentage: 1,
      costUsd: 0.0042,
    };
    expect(sample.inputTokens + (sample.outputTokens ?? 0)).toBe(150);
  });

  it('still accepts the legacy minimal shape', () => {
    const legacy: UsageInfo = {
      inputTokens: 100,
      contextWindow: 200_000,
      contextTokens: 100,
      percentage: 0,
    };
    expect(legacy.contextTokens).toBe(100);
  });
});
