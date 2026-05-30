import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

describe('Opencode customModels', () => {
  describe('model catalog with custom models', () => {
    it('should return empty custom models by default', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          opencode: {},
        },
      };
      const opcodeSettings = getOpencodeProviderSettings(settings);
      expect(opcodeSettings.customModels).toEqual([]);
    });

    it('should load custom model with context window', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          opencode: {
            customModels: [
              {
                id: 'my-opencode-model',
                label: 'My Opencode Model',
                contextWindow: 200000,
                source: 'user',
              },
            ],
          },
        },
      };
      const opcodeSettings = getOpencodeProviderSettings(settings);
      expect(opcodeSettings.customModels).toHaveLength(1);
      expect(opcodeSettings.customModels[0].id).toBe('my-opencode-model');
      expect(opcodeSettings.customModels[0].label).toBe('My Opencode Model');
      expect(opcodeSettings.customModels[0].contextWindow).toBe(200000);
    });

    it('should filter out invalid custom models', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          opencode: {
            customModels: [
              {
                id: 'valid-model',
                contextWindow: 100000,
                source: 'user',
              },
              {
                id: '', // Empty ID should be filtered
                contextWindow: 50000,
                source: 'user',
              },
              {
                id: 'invalid-context-window',
                contextWindow: -5000, // Negative context window should be dropped
                source: 'user',
              },
            ],
          },
        },
      };
      const opcodeSettings = getOpencodeProviderSettings(settings);
      expect(opcodeSettings.customModels).toHaveLength(2);
      expect(opcodeSettings.customModels[0].id).toBe('valid-model');
      expect(opcodeSettings.customModels[0].contextWindow).toBe(100000);
      expect(opcodeSettings.customModels[1].id).toBe('invalid-context-window');
      expect(opcodeSettings.customModels[1].contextWindow).toBeUndefined();
    });
  });
});
