import { getCodexModelOptions, resolveCodexModelSelection } from '@/providers/codex/modelOptions';
import { getCodexProviderSettings } from '@/providers/codex/settings';

describe('Codex customModels', () => {
  describe('model catalog with custom models', () => {
    it('should return model options without custom models', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            customModels: [],
          },
        },
      };
      const options = getCodexModelOptions(settings);
      expect(options.length).toBeGreaterThan(0);
      expect(options[0].value).toBe('gpt-5.4-mini');
    });

    it('should merge custom model with context window into model options', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            customModels: [
              {
                id: 'my-custom-codex-model',
                label: 'My Custom Model',
                contextWindow: 200000,
                source: 'user',
              },
            ],
          },
        },
      };
      const options = getCodexModelOptions(settings);
      const customOption = options.find(opt => opt.value === 'my-custom-codex-model');
      expect(customOption).toBeDefined();
      expect(customOption?.label).toBe('My Custom Model');
      expect(customOption?.contextWindow).toBe(200000);
    });

    it('should apply context window from custom models in settings', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            customModels: [
              {
                id: 'gpt-5.5-extended',
                contextWindow: 300000,
                source: 'user',
              },
            ],
          },
        },
      };
      const codexSettings = getCodexProviderSettings(settings);
      expect(codexSettings.customModels[0].contextWindow).toBe(300000);
    });
  });
});
