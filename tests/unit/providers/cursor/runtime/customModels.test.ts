import { getCursorProviderSettings } from '@/providers/cursor/settings';

describe('Cursor customModels', () => {
  describe('model catalog with custom models', () => {
    it('should return empty custom models by default', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          cursor: {},
        },
      };
      const cursorSettings = getCursorProviderSettings(settings);
      expect(cursorSettings.customModels).toEqual([]);
    });

    it('should load custom model with context window', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          cursor: {
            customModels: [
              {
                id: 'my-cursor-model',
                label: 'My Custom Cursor Model',
                contextWindow: 200000,
                source: 'user',
              },
            ],
          },
        },
      };
      const cursorSettings = getCursorProviderSettings(settings);
      expect(cursorSettings.customModels).toHaveLength(1);
      expect(cursorSettings.customModels[0].id).toBe('my-cursor-model');
      expect(cursorSettings.customModels[0].label).toBe('My Custom Cursor Model');
      expect(cursorSettings.customModels[0].contextWindow).toBe(200000);
    });

    it('should deduplicate custom models by case-insensitive id', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          cursor: {
            customModels: [
              {
                id: 'composer-custom',
                contextWindow: 150000,
                source: 'user',
              },
              {
                id: 'COMPOSER-CUSTOM', // Duplicate with different case
                contextWindow: 200000,
                source: 'user',
              },
            ],
          },
        },
      };
      const cursorSettings = getCursorProviderSettings(settings);
      expect(cursorSettings.customModels).toHaveLength(1);
      expect(cursorSettings.customModels[0].id).toBe('composer-custom');
      expect(cursorSettings.customModels[0].contextWindow).toBe(150000);
    });
  });
});
