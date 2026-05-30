import { getCodexModelOptions } from '@/providers/codex/modelOptions';

describe('getCodexModelOptions with customModels array shape', () => {
  it('appends custom models from the array shape after the built-in options', () => {
    const options = getCodexModelOptions({
      providerConfigs: {
        codex: {
          customModels: [
            { id: 'gpt-5.6-preview', source: 'user' },
            { id: 'my-custom-model', source: 'user' },
          ],
        },
      },
    });

    const values = options.map(option => option.value);
    expect(values).toContain('gpt-5.6-preview');
    expect(values).toContain('my-custom-model');
    // Built-in defaults still present
    expect(values).toContain('gpt-5.4-mini');
    expect(values).toContain('gpt-5.5');
  });

  it('still parses a legacy newline-delimited string', () => {
    const options = getCodexModelOptions({
      providerConfigs: {
        codex: {
          customModels: 'gpt-5.6-preview\nmy-custom-model',
        },
      },
    });

    const values = options.map(option => option.value);
    expect(values).toContain('gpt-5.6-preview');
    expect(values).toContain('my-custom-model');
  });

  it('deduplicates ids across the array', () => {
    const options = getCodexModelOptions({
      providerConfigs: {
        codex: {
          customModels: [
            { id: 'my-custom-model', source: 'user' },
            { id: 'my-custom-model', source: 'user' },
          ],
        },
      },
    });

    const customCount = options.filter(option => option.value === 'my-custom-model').length;
    expect(customCount).toBe(1);
  });

  it('surfaces contextWindow on the option when the custom row sets one', () => {
    const options = getCodexModelOptions({
      providerConfigs: {
        codex: {
          customModels: [
            { id: 'gpt-custom', label: 'Custom GPT', contextWindow: 256000, source: 'user' },
          ],
        },
      },
    });

    const opt = options.find(option => option.value === 'gpt-custom');
    expect(opt).toBeDefined();
    expect(opt?.contextWindow).toBe(256000);
    expect(opt?.label).toBe('Custom GPT');
    expect(opt?.description).toBe('Custom model');
  });

  it('omits contextWindow on the option when the custom row does not set one', () => {
    const options = getCodexModelOptions({
      providerConfigs: {
        codex: {
          customModels: [
            { id: 'gpt-custom', source: 'user' },
          ],
        },
      },
    });

    const opt = options.find(option => option.value === 'gpt-custom');
    expect(opt).toBeDefined();
    expect(opt).not.toHaveProperty('contextWindow');
  });
});
