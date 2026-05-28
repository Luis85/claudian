import { TOOL_READ, TOOL_WRITE } from '@/core/tools/toolNames';
import { CursorNdjsonStreamReducer } from '@/providers/cursor/runtime/cursorStreamMapper';

import { SAMPLE_CURSOR_TOOL_TURN_STREAM_LINES } from '../../../../fixtures/providers/cursor/sampleToolTurnStream';

describe('CursorNdjsonStreamReducer sample tool turn fixture', () => {
  it('maps a read→edit turn without duplicating assistant text across tools', () => {
    const reducer = new CursorNdjsonStreamReducer();
    const textChunks: string[] = [];
    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    const toolResults: Array<{ id: string; content: string }> = [];
    let sessionId: string | undefined;

    for (const line of SAMPLE_CURSOR_TOOL_TURN_STREAM_LINES) {
      const { chunks, sessionId: sid } = reducer.reduceLine(line);
      if (sid) {
        sessionId = sid;
      }
      for (const chunk of chunks) {
        if (chunk.type === 'text') {
          textChunks.push(chunk.content);
        }
        if (chunk.type === 'tool_use') {
          toolUses.push({ id: chunk.id, name: chunk.name, input: chunk.input });
        }
        if (chunk.type === 'tool_result') {
          toolResults.push({ id: chunk.id, content: chunk.content });
        }
      }
    }

    expect(sessionId).toBe('fixture-session');
    expect(textChunks.join('')).toBe(
      'I will read the file first.\n\nNow I will edit it.\n\nDone.',
    );
    expect(toolUses).toEqual([
      { id: 'call-read-1', name: TOOL_READ, input: { file_path: 'README.md' } },
      { id: 'call-edit-1', name: TOOL_WRITE, input: { file_path: 'README.md', content: '# Hello World' } },
    ]);
    expect(toolResults).toEqual([
      { id: 'call-read-1', content: '# Hello' },
      { id: 'call-edit-1', content: expect.stringContaining('Updated README.md') },
    ]);
  });
});
