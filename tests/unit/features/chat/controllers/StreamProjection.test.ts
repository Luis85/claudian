import type { StreamChunk, UsageInfo } from '@/core/types';
import {
  projectBlockTransition,
  projectCompactBoundary,
  type ProjectionBlockState,
  projectNoticeText,
  projectUsage,
  type UsageProjectionInput,
} from '@/features/chat/controllers/StreamProjection';

function blockState(overrides: Partial<ProjectionBlockState> = {}): ProjectionBlockState {
  return { hasOpenTextBlock: false, hasOpenThinkingBlock: false, ...overrides };
}

function usageInput(overrides: Partial<UsageProjectionInput> = {}): UsageProjectionInput {
  return {
    currentSessionId: 'session-1',
    subagentsSpawnedThisStream: 0,
    ignoreUsageUpdates: false,
    activeProviderModel: undefined,
    ...overrides,
  };
}

function makeUsage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    model: 'model-a',
    inputTokens: 10,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindow: 100,
    contextTokens: 10,
    percentage: 10,
    ...overrides,
  } as UsageInfo;
}

describe('StreamProjection - block transitions', () => {
  describe('thinking chunk', () => {
    it('flushes tools and finalizes an open text block', () => {
      expect(projectBlockTransition('thinking', blockState({ hasOpenTextBlock: true }))).toEqual({
        flushPendingTools: true,
        finalizeThinking: false,
        finalizeText: true,
      });
    });

    it('does not finalize text when no text block is open', () => {
      expect(projectBlockTransition('thinking', blockState())).toEqual({
        flushPendingTools: true,
        finalizeThinking: false,
        finalizeText: false,
      });
    });
  });

  describe('text chunk', () => {
    it('flushes tools and finalizes an open thinking block', () => {
      expect(projectBlockTransition('text', blockState({ hasOpenThinkingBlock: true }))).toEqual({
        flushPendingTools: true,
        finalizeThinking: true,
        finalizeText: false,
      });
    });

    it('does not finalize thinking when none is open', () => {
      expect(projectBlockTransition('text', blockState())).toEqual({
        flushPendingTools: true,
        finalizeThinking: false,
        finalizeText: false,
      });
    });
  });

  describe('tool_use chunk', () => {
    it('finalizes an open thinking block and always finalizes text', () => {
      expect(projectBlockTransition('tool_use', blockState({ hasOpenThinkingBlock: true }))).toEqual({
        flushPendingTools: false,
        finalizeThinking: true,
        finalizeText: true,
      });
    });

    it('always requests text finalization even when no text block is open', () => {
      // Mirrors the original unconditional finalizeCurrentTextBlock call (no-op when none open).
      expect(projectBlockTransition('tool_use', blockState())).toEqual({
        flushPendingTools: false,
        finalizeThinking: false,
        finalizeText: true,
      });
    });
  });

  describe('compact boundary', () => {
    it('flushes tools, finalizes open thinking, and always finalizes text', () => {
      expect(projectCompactBoundary(blockState({ hasOpenThinkingBlock: true }))).toEqual({
        flushPendingTools: true,
        finalizeThinking: true,
        finalizeText: true,
      });
    });

    it('still finalizes text when nothing is open', () => {
      expect(projectCompactBoundary(blockState())).toEqual({
        flushPendingTools: true,
        finalizeThinking: false,
        finalizeText: true,
      });
    });
  });
});

describe('StreamProjection - notice text', () => {
  it('formats a warning notice as Blocked', () => {
    const chunk = { type: 'notice', content: 'Tool was blocked', level: 'warning' } as Extract<
      StreamChunk,
      { type: 'notice' }
    >;
    expect(projectNoticeText(chunk)).toBe('\n\n⚠️ **Blocked:** Tool was blocked');
  });

  it('formats an info notice as Notice', () => {
    const chunk = { type: 'notice', content: 'Heads up', level: 'info' } as Extract<
      StreamChunk,
      { type: 'notice' }
    >;
    expect(projectNoticeText(chunk)).toBe('\n\n⚠️ **Notice:** Heads up');
  });

  it('formats a level-less notice as Notice', () => {
    const chunk = { type: 'notice', content: 'No level' } as Extract<StreamChunk, { type: 'notice' }>;
    expect(projectNoticeText(chunk)).toBe('\n\n⚠️ **Notice:** No level');
  });
});

describe('StreamProjection - usage filtering', () => {
  function usageChunk(usage: UsageInfo, sessionId?: string | null): Extract<StreamChunk, { type: 'usage' }> {
    return { type: 'usage', usage, sessionId };
  }

  it('updates usage for the current session', () => {
    const usage = makeUsage();
    expect(projectUsage(usageChunk(usage, 'session-1'), usageInput())).toEqual({
      action: 'update',
      usage,
    });
  });

  it('updates usage when the chunk has no session id', () => {
    const usage = makeUsage();
    expect(projectUsage(usageChunk(usage), usageInput())).toEqual({ action: 'update', usage });
  });

  it('ignores usage from a different session', () => {
    expect(projectUsage(usageChunk(makeUsage(), 'session-2'), usageInput({ currentSessionId: 'session-1' }))).toEqual({
      action: 'ignore',
    });
  });

  it('ignores session-tagged usage when no session is active yet', () => {
    expect(projectUsage(usageChunk(makeUsage(), 'some-session'), usageInput({ currentSessionId: null }))).toEqual({
      action: 'ignore',
    });
  });

  it('ignores usage once subagents ran (cumulative usage)', () => {
    expect(
      projectUsage(usageChunk(makeUsage(), 'session-1'), usageInput({ subagentsSpawnedThisStream: 1 })),
    ).toEqual({ action: 'ignore' });
  });

  it('ignores usage when the ignore flag is set', () => {
    expect(
      projectUsage(usageChunk(makeUsage(), 'session-1'), usageInput({ ignoreUsageUpdates: true })),
    ).toEqual({ action: 'ignore' });
  });

  it('stamps the active provider model when the chunk omits it', () => {
    const usage = makeUsage({ model: undefined as unknown as string });
    expect(
      projectUsage(usageChunk(usage, 'session-1'), usageInput({ activeProviderModel: 'codex-large' })),
    ).toEqual({ action: 'update', usage: { ...usage, model: 'codex-large' } });
  });

  it('does not overwrite a model already present on the usage chunk', () => {
    const usage = makeUsage({ model: 'authoritative-model' });
    expect(
      projectUsage(usageChunk(usage, 'session-1'), usageInput({ activeProviderModel: 'codex-large' })),
    ).toEqual({ action: 'update', usage });
  });
});
