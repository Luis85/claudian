import { buildUsageInfo, clampPercentage } from '../../../../../src/core/providers/usage';

describe('clampPercentage', () => {
  it('returns 0 when window is non-positive', () => {
    expect(clampPercentage(100, 0)).toBe(0);
    expect(clampPercentage(100, -1)).toBe(0);
  });
  it('clamps to [0,100] and rounds to whole percent', () => {
    expect(clampPercentage(50, 200)).toBe(25);
    expect(clampPercentage(150, 100)).toBe(100);
    expect(clampPercentage(-5, 100)).toBe(0);
  });
});

describe('buildUsageInfo', () => {
  it('requires a model and produces a fully-populated UsageInfo', () => {
    const usage = buildUsageInfo({
      model: 'claude-sonnet-4',
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 40,
      contextTokens: 150,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
    });
    expect(usage.model).toBe('claude-sonnet-4');
    expect(usage.percentage).toBe(0);
    expect(usage.contextWindowIsAuthoritative).toBe(true);
  });

  it('rejects an empty model id', () => {
    expect(() =>
      buildUsageInfo({
        model: '',
        inputTokens: 0,
        contextTokens: 0,
        contextWindow: 200_000,
      }),
    ).toThrow(/model id is required/i);
  });

  it('treats missing cache/output as 0 on the persisted shape', () => {
    const usage = buildUsageInfo({
      model: 'gpt-5.3-codex',
      inputTokens: 100,
      contextTokens: 100,
      contextWindow: 200_000,
    });
    expect(usage.cacheCreationInputTokens ?? 0).toBe(0);
    expect(usage.cacheReadInputTokens ?? 0).toBe(0);
    expect(usage.outputTokens ?? 0).toBe(0);
  });

  it('propagates costUsd when present', () => {
    const usage = buildUsageInfo({
      model: 'claude-haiku-4',
      inputTokens: 10,
      contextTokens: 10,
      contextWindow: 200_000,
      costUsd: 0.00012,
    });
    expect(usage.costUsd).toBeCloseTo(0.00012);
  });
});
