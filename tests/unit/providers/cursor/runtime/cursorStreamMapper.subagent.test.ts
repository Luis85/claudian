import { TOOL_GLOB, TOOL_SUBAGENT } from '@/core/tools/toolNames';
import { CursorNdjsonStreamReducer } from '@/providers/cursor/runtime/cursorStreamMapper';
import { CursorTaskResultInterpreter } from '@/providers/cursor/runtime/CursorTaskResultInterpreter';

import { SAMPLE_CURSOR_TASK_SUBAGENT_STREAM_LINES } from '../../../../fixtures/providers/cursor/sampleTaskSubagentStream';

describe('CursorNdjsonStreamReducer sync task fixture', () => {
  it('emits Agent tool_result with conversationSteps for nested hydration', () => {
    const reducer = new CursorNdjsonStreamReducer();
    const interpreter = new CursorTaskResultInterpreter();
    let taskResult: { id: string; content: string; toolUseResult?: unknown } | undefined;

    for (const line of SAMPLE_CURSOR_TASK_SUBAGENT_STREAM_LINES) {
      const { chunks } = reducer.reduceLine(line);
      for (const chunk of chunks) {
        if (chunk.type === 'tool_result' && chunk.id === 'task-call-1') {
          taskResult = chunk;
        }
      }
    }

    expect(taskResult).toBeDefined();
    expect(taskResult?.content).toBe('src/core/CLAUDE.md');

    const nested = interpreter.extractNestedToolCalls?.(
      taskResult?.toolUseResult,
      'task-call-1',
    );
    expect(nested).toHaveLength(1);
    expect(nested?.[0]).toMatchObject({ name: TOOL_GLOB, status: 'completed' });
  });

  it('maps taskToolCall start args including subagent_type', () => {
    const reducer = new CursorNdjsonStreamReducer();
    const toolUse = SAMPLE_CURSOR_TASK_SUBAGENT_STREAM_LINES.flatMap(line => {
      const { chunks } = reducer.reduceLine(line);
      return chunks.filter(chunk => chunk.type === 'tool_use');
    });

    expect(toolUse).toEqual([
      expect.objectContaining({
        id: 'task-call-1',
        name: TOOL_SUBAGENT,
        input: expect.objectContaining({
          description: 'List core',
          subagent_type: 'explore',
        }),
      }),
    ]);
  });
});
