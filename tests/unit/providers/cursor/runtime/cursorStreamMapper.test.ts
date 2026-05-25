import {
  cursorContextWindowForModel,
  CursorNdjsonStreamReducer,
  extractCursorUsage,
} from '@/providers/cursor/runtime/cursorStreamMapper';

describe('CursorNdjsonStreamReducer', () => {
  it('emits text deltas for cumulative assistant output', () => {
    const r = new CursorNdjsonStreamReducer();
    const a = r.reduceLine(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hel' }] },
      session_id: 's1',
    }));
    expect(a.chunks).toEqual([{ type: 'text', content: 'hel' }]);
    expect(a.sessionId).toBe('s1');

    const b = r.reduceLine(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      session_id: 's1',
    }));
    expect(b.chunks).toEqual([{ type: 'text', content: 'lo' }]);
  });

  it('emits tool_use on started and tool_result on completed', () => {
    const r = new CursorNdjsonStreamReducer();
    const start = r.reduceLine(JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      call_id: 'c1',
      tool_call: { readToolCall: { args: { path: 'a.md' } } },
    }));
    expect(start.chunks).toEqual([{
      type: 'tool_use',
      id: 'c1',
      name: 'read_file',
      input: { path: 'a.md' },
    }]);

    const done = r.reduceLine(JSON.stringify({
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'c1',
      tool_call: { readToolCall: { args: { path: 'a.md' }, result: { success: { content: 'x' } } } },
    }));
    expect(done.chunks[0]).toMatchObject({
      type: 'tool_result',
      id: 'c1',
      content: expect.stringContaining('readToolCall'),
    });
  });

  it('ends with usage and done on result success', () => {
    const r = new CursorNdjsonStreamReducer();
    const out = r.reduceLine(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 's9',
    }));
    expect(out.chunks.map(c => c.type)).toEqual(['usage', 'done']);
  });

  it('does not re-emit pre-tool assistant text after a tool call', () => {
    const r = new CursorNdjsonStreamReducer();
    const a = r.reduceLine(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Let me check.' }] },
    }));
    expect(a.chunks).toEqual([{ type: 'text', content: 'Let me check.' }]);

    // A tool call happens mid-turn.
    r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'started', call_id: 'c1',
      tool_call: { readToolCall: { args: { path: 'a.md' } } },
    }));
    r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'completed', call_id: 'c1',
      tool_call: { readToolCall: { args: { path: 'a.md' }, result: {} } },
    }));

    // Cursor re-sends the cumulative full-turn text, now extended.
    const b = r.reduceLine(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Let me check. The answer is 42.' }] },
    }));
    // Only the new suffix is emitted — not the whole answer again.
    expect(b.chunks).toEqual([{ type: 'text', content: ' The answer is 42.' }]);
  });

  it('caps oversized tool_result content to avoid freezing the UI', () => {
    const r = new CursorNdjsonStreamReducer();
    const huge = 'x'.repeat(250_000);
    const out = r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'completed', call_id: 'c1',
      tool_call: { readToolCall: { args: {}, result: { success: { content: huge } } } },
    }));
    const chunk = out.chunks[0] as { type: string; content: string };
    expect(chunk.type).toBe('tool_result');
    expect(chunk.content.length).toBeLessThan(huge.length);
    expect(chunk.content).toContain('truncated');
  });

  it('uses the model from the system event for the usage context window', () => {
    const r = new CursorNdjsonStreamReducer();
    r.reduceLine(JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'gemini-2.5-pro',
      session_id: 's1',
    }));
    const out = r.reduceLine(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 's1',
    }));
    const usage = out.chunks[0] as { type: string; usage: { contextWindow: number; contextTokens: number; inputTokens: number; percentage: number } };
    expect(usage.type).toBe('usage');
    expect(usage.usage.contextWindow).toBe(1_000_000);
    expect(usage.usage.contextTokens).toBe(0);
    expect(usage.usage.inputTokens).toBe(0);
    expect(usage.usage.percentage).toBe(0);
  });

  it('falls back to a claude/sonnet context window of 200k', () => {
    const r = new CursorNdjsonStreamReducer();
    r.reduceLine(JSON.stringify({ type: 'system', model: 'claude-4.5-sonnet', session_id: 's1' }));
    const out = r.reduceLine(JSON.stringify({ type: 'result', is_error: false, session_id: 's1' }));
    const usage = out.chunks[0] as { usage: { contextWindow: number } };
    expect(usage.usage.contextWindow).toBe(200_000);
  });

  it('emits real token data from a result usage object', () => {
    const r = new CursorNdjsonStreamReducer();
    r.reduceLine(JSON.stringify({ type: 'system', model: 'gpt-5', session_id: 's1' }));
    const out = r.reduceLine(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 's1',
      usage: { input_tokens: 1000, output_tokens: 3000 },
    }));
    const usage = out.chunks[0] as { usage: { inputTokens: number; contextTokens: number; contextWindow: number; percentage: number } };
    expect(usage.usage.inputTokens).toBe(1000);
    expect(usage.usage.contextTokens).toBe(4000);
    expect(usage.usage.contextWindow).toBe(400_000);
    expect(usage.usage.percentage).toBe(1);
  });

  it('prefers an explicit context_window from the usage data', () => {
    const r = new CursorNdjsonStreamReducer();
    const out = r.reduceLine(JSON.stringify({
      type: 'result',
      is_error: false,
      usage: { total_tokens: 50_000, context_window: 100_000 },
    }));
    const usage = out.chunks[0] as { usage: { contextTokens: number; contextWindow: number; percentage: number } };
    expect(usage.usage.contextTokens).toBe(50_000);
    expect(usage.usage.contextWindow).toBe(100_000);
    expect(usage.usage.percentage).toBe(50);
  });

  it('emits a thinking chunk for a thinking block and still emits text', () => {
    const r = new CursorNdjsonStreamReducer();
    const out = r.reduceLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me reason about this.' },
          { type: 'text', text: 'Answer.' },
        ],
      },
      session_id: 's1',
    }));
    expect(out.chunks).toEqual([
      { type: 'thinking', content: 'Let me reason about this.' },
      { type: 'text', content: 'Answer.' },
    ]);
  });

  it('emits only the thinking delta across cumulative assistant events', () => {
    const r = new CursorNdjsonStreamReducer();
    r.reduceLine(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Step 1.' }] },
    }));
    const b = r.reduceLine(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Step 1. Step 2.' }] },
    }));
    expect(b.chunks).toEqual([{ type: 'thinking', content: ' Step 2.' }]);
  });

  it('emits a thinking chunk for a top-level reasoning event', () => {
    const r = new CursorNdjsonStreamReducer();
    const out = r.reduceLine(JSON.stringify({ type: 'reasoning', text: 'thinking aloud' }));
    expect(out.chunks).toEqual([{ type: 'thinking', content: 'thinking aloud' }]);
  });

  describe('extractCursorUsage', () => {
    it('returns the per-model window with zeroed tokens when no usage data', () => {
      expect(extractCursorUsage({}, 'gemini-2.5-pro')).toEqual({
        inputTokens: 0,
        contextTokens: 0,
        contextWindow: 1_000_000,
        percentage: 0,
      });
    });

    it('reads camelCase and message.usage shapes', () => {
      const fromMessage = extractCursorUsage(
        { message: { usage: { inputTokens: 200, outputTokens: 800 } } },
        'claude-sonnet',
      );
      expect(fromMessage.inputTokens).toBe(200);
      expect(fromMessage.outputTokens).toBe(800);
      expect(fromMessage.contextTokens).toBe(1000);
      expect(fromMessage.contextWindow).toBe(200_000);
    });

    it('falls back to top-level num_tokens for the total', () => {
      const u = extractCursorUsage({ num_tokens: 1234 }, 'unknown-model');
      expect(u.contextTokens).toBe(1234);
      expect(u.inputTokens).toBe(0);
    });

    it('does not throw on weird shapes', () => {
      expect(() => extractCursorUsage({ usage: 'nope', message: 5 } as never, undefined)).not.toThrow();
    });
  });

  describe('cursorContextWindowForModel', () => {
    it('maps known model families', () => {
      expect(cursorContextWindowForModel('gemini-2.5-pro')).toBe(1_000_000);
      expect(cursorContextWindowForModel('GPT-5')).toBe(400_000);
      expect(cursorContextWindowForModel('claude-opus')).toBe(200_000);
      expect(cursorContextWindowForModel('composer-1')).toBe(200_000);
      expect(cursorContextWindowForModel(undefined)).toBe(200_000);
    });
  });
});
