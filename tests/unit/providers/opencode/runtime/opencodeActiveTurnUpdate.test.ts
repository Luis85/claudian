import type { AcpToolStreamAdapter } from '@/providers/acp';
import {
  type ActiveTurnUpdateContext,
  buildActiveTurnEffect,
} from '@/providers/opencode/runtime/opencodeActiveTurnUpdate';

function makeContext(overrides: Partial<ActiveTurnUpdateContext> = {}): ActiveTurnUpdateContext {
  const toolStreamAdapter = {
    normalizeToolCall: jest.fn().mockReturnValue([{ type: 'tool_use', id: 'tc1' }]),
    normalizeToolCallUpdate: jest.fn().mockReturnValue([{ type: 'tool_result', id: 'tc1' }]),
  } as unknown as AcpToolStreamAdapter;
  return {
    toolStreamAdapter,
    sessionId: 'sess-1',
    resolveUsageModel: () => 'model-x',
    promptUsage: null,
    ...overrides,
  };
}

const content = { type: 'text', text: 'hi' } as never;

describe('buildActiveTurnEffect — message_chunk', () => {
  it('captures the assistant messageId and flags assistant content', () => {
    const chunks = [{ type: 'text', content: 'hi' }] as never;
    const effect = buildActiveTurnEffect(
      { type: 'message_chunk', role: 'assistant', messageId: 'a1', content, streamChunks: chunks },
      makeContext(),
    );
    expect(effect.metadataPatch).toEqual({ assistantMessageId: 'a1' });
    expect(effect.sawAssistantContent).toBe(true);
    expect(effect.chunks).toEqual(chunks);
  });

  it('captures the user messageId and does not flag assistant content', () => {
    const effect = buildActiveTurnEffect(
      { type: 'message_chunk', role: 'user', messageId: 'u1', content, streamChunks: [] },
      makeContext(),
    );
    expect(effect.metadataPatch).toEqual({ userMessageId: 'u1' });
    expect(effect.sawAssistantContent).toBe(false);
  });

  it('does not flag assistant content when the assistant chunk is empty', () => {
    const effect = buildActiveTurnEffect(
      { type: 'message_chunk', role: 'assistant', messageId: 'a1', content, streamChunks: [] },
      makeContext(),
    );
    expect(effect.sawAssistantContent).toBe(false);
  });
});

describe('buildActiveTurnEffect — tool calls', () => {
  it('routes tool_call through normalizeToolCall', () => {
    const ctx = makeContext();
    const effect = buildActiveTurnEffect(
      { type: 'tool_call', toolCall: { id: 'tc1' } as never, toolState: {} as never, streamChunks: [] },
      ctx,
    );
    expect(ctx.toolStreamAdapter.normalizeToolCall).toHaveBeenCalled();
    expect(effect.chunks).toEqual([{ type: 'tool_use', id: 'tc1' }]);
  });

  it('routes tool_call_update through normalizeToolCallUpdate', () => {
    const ctx = makeContext();
    const effect = buildActiveTurnEffect(
      { type: 'tool_call_update', toolCallUpdate: { id: 'tc1' } as never, toolState: {} as never, streamChunks: [] },
      ctx,
    );
    expect(ctx.toolStreamAdapter.normalizeToolCallUpdate).toHaveBeenCalled();
    expect(effect.chunks).toEqual([{ type: 'tool_result', id: 'tc1' }]);
  });
});

describe('buildActiveTurnEffect — usage', () => {
  it('emits a usage chunk and records context usage when usage info builds', () => {
    const usage = { used: 100, size: 1000 } as never;
    const effect = buildActiveTurnEffect({ type: 'usage', usage }, makeContext());
    expect(effect.chunks).toHaveLength(1);
    expect(effect.chunks[0]).toMatchObject({ sessionId: 'sess-1', type: 'usage' });
    expect(effect.contextUsage).toBe(usage);
  });

  it('emits no chunk when usage info is null but still records context usage', () => {
    const effect = buildActiveTurnEffect(
      { type: 'usage', usage: null as never },
      makeContext({ promptUsage: null }),
    );
    expect(effect.chunks).toEqual([]);
  });
});
