import { createTransformUsageState } from '../../../../../src/providers/claude/stream/transformClaudeMessage';

describe('TransformUsageState.mergePromptUsage', () => {
  it('keeps cache fields monotone (high-water-mark)', () => {
    const state = createTransformUsageState();
    state.mergePromptUsage({ input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 });
    const after = state.mergePromptUsage({ input_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 25 });
    expect(after.cacheCreationInputTokens).toBe(20);
    expect(after.cacheReadInputTokens).toBe(30);
  });

  it('uses the latest snapshot for inputTokens (no high-water-mark drift)', () => {
    const state = createTransformUsageState();
    state.mergePromptUsage({ input_tokens: 5000 });
    const after = state.mergePromptUsage({ input_tokens: 4800 });
    expect(after.inputTokens).toBe(4800);
  });

  it('falls back to the previous inputTokens when next snapshot reports 0', () => {
    const state = createTransformUsageState();
    state.mergePromptUsage({ input_tokens: 5000 });
    const after = state.mergePromptUsage({ input_tokens: 0 });
    expect(after.inputTokens).toBe(5000);
  });
});
