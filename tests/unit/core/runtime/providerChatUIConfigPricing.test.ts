import type { ModelPricing, ProviderChatUIConfig } from '../../../../src/core/providers/types';

describe('ProviderChatUIConfig.getModelPricing', () => {
  it('is an optional method that returns ModelPricing | null', () => {
    const fake: Partial<ProviderChatUIConfig> = {
      getModelPricing: (id: string): ModelPricing | null =>
        id === 'claude-sonnet-4'
          ? { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 }
          : null,
    };
    expect(fake.getModelPricing?.('claude-sonnet-4')?.inputPer1M).toBe(3);
    expect(fake.getModelPricing?.('unknown')).toBeNull();
  });
});
