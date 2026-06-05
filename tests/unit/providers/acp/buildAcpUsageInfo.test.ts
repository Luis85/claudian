import { buildAcpUsageInfo } from '../../../../src/providers/acp/buildAcpUsageInfo';

describe('buildAcpUsageInfo', () => {
  it('preserves outputTokens and thoughtTokens from AcpUsage', () => {
    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: {
        inputTokens: 1000,
        outputTokens: 250,
        cachedReadTokens: 200,
        cachedWriteTokens: 100,
        thoughtTokens: 50,
        totalTokens: 1600,
      },
      contextWindow: { size: 200_000, used: 1600 },
    });
    expect(usage).not.toBeNull();
    expect(usage?.outputTokens).toBe(250);
    expect(usage?.thoughtTokens).toBe(50);
    expect(usage?.cacheReadInputTokens).toBe(200);
    expect(usage?.cacheCreationInputTokens).toBe(100);
    expect(usage?.contextTokens).toBe(1600);
    expect(usage?.model).toBe('sonnet-via-opencode');
  });

  it('surfaces costUsd when AcpUsageUpdate carries USD cost', () => {
    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: null,
      contextWindow: { size: 200_000, used: 5000, cost: { amount: 0.0123, currency: 'USD' } },
    });
    expect(usage?.costUsd).toBeCloseTo(0.0123);
  });

  it('ignores non-USD cost (no conversion done)', () => {
    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: null,
      contextWindow: { size: 200_000, used: 5000, cost: { amount: 1.0, currency: 'EUR' } },
    });
    expect(usage?.costUsd).toBeUndefined();
  });

  it('returns null when both promptUsage and contextWindow are absent', () => {
    const usage = buildAcpUsageInfo({ model: 'sonnet-via-opencode' });
    expect(usage).toBeNull();
  });

  it('throws when called without a model id (shared builder contract)', () => {
    expect(() =>
      buildAcpUsageInfo({ model: '', promptUsage: null, contextWindow: { size: 100, used: 0 } }),
    ).toThrow();
  });

  it('omits cacheCreationInputTokens entirely when cachedWriteTokens is null/undefined (no phantom zero)', () => {
    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: {
        inputTokens: 100,
        outputTokens: 0,
        totalTokens: 100,
        // no cachedReadTokens, no cachedWriteTokens, no thoughtTokens
      },
      contextWindow: { size: 200_000, used: 100 },
    });
    expect(usage?.cacheCreationInputTokens).toBeUndefined();
    expect(usage?.cacheReadInputTokens).toBeUndefined();
    expect(usage?.thoughtTokens).toBeUndefined();
  });
});
