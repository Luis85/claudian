import { getClaudeModelOptions } from '@/providers/claude/modelOptions';

describe('getClaudeModelOptions with customModels array shape', () => {
  it('appends custom models from the array shape after the built-in options', () => {
    const options = getClaudeModelOptions({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'claude-opus-4-6', source: 'user' },
            { id: 'claude-opus-4-6[1m]', source: 'user' },
          ],
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
  });

  it('respects a row label for the custom option label', () => {
    const options = getClaudeModelOptions({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'claude-opus-4-6', label: 'Work Opus', source: 'user' },
          ],
        },
      },
    });

    expect(options.at(-1)).toEqual({
      value: 'claude-opus-4-6',
      label: 'Work Opus',
      description: 'Custom model',
    });
  });

  it('keeps deduplication when ids repeat in the array', () => {
    const options = getClaudeModelOptions({
      providerConfigs: {
        claude: {
          customModels: [
            { id: 'haiku', source: 'user' },
            { id: 'claude-opus-4-6', source: 'user' },
            { id: 'claude-opus-4-6', source: 'user' },
          ],
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

  it('still parses a legacy newline-delimited string from disk via the normalizer', () => {
    const options = getClaudeModelOptions({
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
  });
});
