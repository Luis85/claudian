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

  it('normalizes readToolCall to the shared Read tool with file_path input', () => {
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
      name: 'Read',
      input: { file_path: 'a.md' },
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
      content: 'x',
    });
  });

  it('normalizes shellToolCall to Bash and unwraps stdout in the result', () => {
    const r = new CursorNdjsonStreamReducer();
    const start = r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'started', call_id: 'c2',
      tool_call: {
        description: 'Echo hi',
        shellToolCall: {
          args: { command: 'echo hi', workingDirectory: '/x' },
        },
      },
    }));
    expect(start.chunks[0]).toMatchObject({
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'echo hi', cwd: '/x', description: 'Echo hi' },
    });

    const done = r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'completed', call_id: 'c2',
      tool_call: {
        shellToolCall: {
          args: { command: 'echo hi' },
          result: { success: { stdout: 'hi\n', stderr: '', exitCode: 0 } },
        },
      },
    }));
    expect(done.chunks[0]).toMatchObject({
      type: 'tool_result',
      id: 'c2',
      content: 'hi',
    });
  });

  it('normalizes globToolCall and lists matching files in the result content', () => {
    const r = new CursorNdjsonStreamReducer();
    const start = r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'started', call_id: 'g1',
      tool_call: {
        globToolCall: { args: { targetDirectory: '/x', globPattern: '*.ts' } },
      },
    }));
    expect(start.chunks[0]).toMatchObject({
      type: 'tool_use',
      name: 'Glob',
      input: { pattern: '*.ts', path: '/x' },
    });

    const done = r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'completed', call_id: 'g1',
      tool_call: {
        globToolCall: {
          args: { targetDirectory: '/x', globPattern: '*.ts' },
          result: { success: { files: ['a.ts', 'b.ts'], totalFiles: 2 } },
        },
      },
    }));
    expect(done.chunks[0]).toMatchObject({
      type: 'tool_result',
      content: expect.stringContaining('a.ts'),
    });
    expect((done.chunks[0] as { content: string }).content).toContain('Found 2 files');
  });

  it('maps editToolCall to Write and surfaces a unified diff for the diff renderer', () => {
    const r = new CursorNdjsonStreamReducer();
    const start = r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'started', call_id: 'e1',
      tool_call: { editToolCall: { args: { path: '/x/a.txt', streamContent: 'probed' } } },
    }));
    expect(start.chunks[0]).toMatchObject({
      type: 'tool_use',
      name: 'Write',
      input: { file_path: '/x/a.txt', content: 'probed' },
    });

    const done = r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'completed', call_id: 'e1',
      tool_call: {
        editToolCall: {
          args: { path: '/x/a.txt', streamContent: 'probed' },
          result: {
            success: {
              path: '/x/a.txt',
              diffString: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-probe\n+probed',
              message: 'Updated',
            },
          },
        },
      },
    }));
    const result = done.chunks[0] as { type: string; toolUseResult?: { unifiedDiff?: string; filePath?: string } };
    expect(result.type).toBe('tool_result');
    expect(result.toolUseResult?.filePath).toBe('/x/a.txt');
    expect(result.toolUseResult?.unifiedDiff).toContain('+probed');
  });

  it('marks tool_result as error when the cursor envelope contains an error payload', () => {
    const r = new CursorNdjsonStreamReducer();
    const done = r.reduceLine(JSON.stringify({
      type: 'tool_call', subtype: 'completed', call_id: 'x1',
      tool_call: {
        readToolCall: {
          args: { path: 'missing.md' },
          result: { error: { code: 'ENOENT', message: 'File not found' } },
        },
      },
    }));
    const chunk = done.chunks[0] as { type: string; isError?: boolean; content: string };
    expect(chunk.type).toBe('tool_result');
    expect(chunk.isError).toBe(true);
    expect(chunk.content).toContain('File not found');
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
      tool_call: { readToolCall: { args: { path: 'a.md' }, result: { success: { content: '' } } } },
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
      tool_call: { readToolCall: { args: { path: 'big.txt' }, result: { success: { content: huge } } } },
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
