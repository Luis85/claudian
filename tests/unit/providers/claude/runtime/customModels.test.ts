import { getContextWindowSize } from '@/providers/claude/types/models';

describe('Claude customModels', () => {
  describe('model catalog with custom models', () => {
    it('should return context window from built-in models when no custom models', () => {
      const contextWindow = getContextWindowSize('haiku');
      expect(contextWindow).toBeGreaterThan(0);
    });

    it('should use context window from custom model override', () => {
      const customContextLimits = {
        'my-custom-model': 200000,
      };
      const contextWindow = getContextWindowSize('my-custom-model', customContextLimits);
      expect(contextWindow).toBe(200000);
    });

    it('should apply context window override for existing model', () => {
      const customContextLimits = {
        'haiku': 150000,
      };
      const contextWindow = getContextWindowSize('haiku', customContextLimits);
      expect(contextWindow).toBe(150000);
    });
  });
});
