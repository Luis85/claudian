import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';

describe('claudeChatUIConfig', () => {
  describe('getModelOptions', () => {
    it('appends settings-defined custom models after the built-in options', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6\nclaude-opus-4-6[1m]',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'claude-opus-4-6',
        'claude-opus-4-6[1m]',
      ]);
      expect(options.slice(-2)).toEqual([
        {
          value: 'claude-opus-4-6',
          label: 'Opus 4.6',
          description: 'Custom model',
        },
        {
          value: 'claude-opus-4-6[1m]',
          label: 'Opus 4.6 (1M)',
          description: 'Custom model',
        },
      ]);
    });

    it('deduplicates settings-defined custom models against exact duplicates', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'haiku\nclaude-opus-4-6\nclaude-opus-4-6\n',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'claude-opus-4-6',
      ]);
    });

    it('formats dated settings-defined custom models with shortened date tags', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-5-20251101',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-opus-4-5-20251101',
        label: 'Opus 4.5 (2511)',
        description: 'Custom model',
      });
    });

    it('uses custom model aliases for settings-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-opus-4-6': 'Work Opus',
        },
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-opus-4-6',
        label: 'Work Opus',
        description: 'Custom model',
      });
    });

    it('keeps environment-defined custom models as a full override', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-sonnet-4-5',
          label: 'Sonnet 4.5',
          description: 'Custom model (model)',
        },
      ]);
    });

    it('uses custom model aliases for environment-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-sonnet-4-5': 'Gateway Sonnet',
        },
        providerConfigs: {
          claude: {
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-sonnet-4-5',
          label: 'Gateway Sonnet',
          description: 'Custom model (model)',
        },
      ]);
    });
  });

  describe('getReasoningOptions', () => {
    it('hides xhigh on models that do not support it', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-sonnet-4-5', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
    });

    it('keeps xhigh on supported opus models', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-opus-4-7', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('uses effort options for custom model ids', () => {
      const options = claudeChatUIConfig.getReasoningOptions('custom-model', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
      expect(options.some(option => option.tokens !== undefined)).toBe(false);
    });
  });

  describe('applyModelDefaults', () => {
    it('clamps stale xhigh effort when switching to a custom sonnet model', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-sonnet-4-5', settings);

      expect(settings.effortLevel).toBe('high');
      expect(settings.lastCustomModel).toBe('claude-sonnet-4-5');
    });

    it('preserves xhigh on custom opus models that support it', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-opus-4-7', settings);

      expect(settings.effortLevel).toBe('xhigh');
    });
  });

  describe('plan label coherence', () => {
    it('uses sentence-case Plan to match other providers', () => {
      expect(claudeChatUIConfig.getPermissionModeToggle?.()?.planLabel).toBe('Plan');
    });
  });

  describe('reconcileModelSelection', () => {
    it('keeps a still-valid selection untouched', () => {
      const settings: Record<string, unknown> = {
        model: 'sonnet',
        providerConfigs: {},
      };

      expect(claudeChatUIConfig.reconcileModelSelection?.(settings)).toBe(false);
      expect(settings.model).toBe('sonnet');
    });

    it('repoints a removed custom model and applies model defaults', () => {
      // The previously selected custom model is no longer in customModels —
      // the exact state a delete in the custom-models table leaves behind.
      const settings: Record<string, unknown> = {
        model: 'my-removed-model',
        providerConfigs: { claude: { customModels: [] } },
      };

      expect(claudeChatUIConfig.reconcileModelSelection?.(settings)).toBe(true);
      const nextModel = settings.model as string;
      expect(nextModel).not.toBe('my-removed-model');
      expect(
        claudeChatUIConfig.getModelOptions(settings).some((o) => o.value === nextModel),
      ).toBe(true);
      // applyModelDefaults side effect for built-in models.
      expect(settings.effortLevel).toBeDefined();
    });

    it('falls back to the provider lastModel when the selection is invalid', () => {
      const settings: Record<string, unknown> = {
        model: 'my-removed-model',
        providerConfigs: { claude: { customModels: [], lastModel: 'opus' } },
      };

      expect(claudeChatUIConfig.reconcileModelSelection?.(settings)).toBe(true);
      expect(settings.model).toBe('opus');
    });
  });
});
