import { CursorNdjsonStreamReducer } from '@/providers/cursor/runtime/cursorStreamMapper';

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
});
