import { TOOL_GLOB, TOOL_SUBAGENT } from '@/core/tools/toolNames';
import type { ToolCallInfo } from '@/core/types';
import { parseCursorSubagentType } from '@/providers/cursor/runtime/cursorTaskPayload';
import { CursorTaskResultInterpreter } from '@/providers/cursor/runtime/CursorTaskResultInterpreter';
import {
  attachCursorSubagentToTaskToolCall,
  extractCursorNestedToolCalls,
} from '@/providers/cursor/runtime/cursorTaskSubagent';
import {
  normalizeCursorToolCompletion,
  normalizeCursorToolStart,
} from '@/providers/cursor/runtime/cursorToolNormalization';

describe('parseCursorSubagentType', () => {
  it('reads the single key from Cursor subagentType objects', () => {
    expect(parseCursorSubagentType({ explore: {} })).toBe('explore');
    expect(parseCursorSubagentType({ unspecified: {} })).toBeUndefined();
    expect(parseCursorSubagentType('generalPurpose')).toBe('generalPurpose');
  });
});

describe('extractCursorNestedToolCalls', () => {
  it('maps nested conversationSteps toolCall envelopes to ToolCallInfo rows', () => {
    const toolUseResult = {
      conversationSteps: [
        {
          toolCall: {
            globToolCall: {
              args: { targetDirectory: '/vault', globPattern: '**/*.md' },
              result: { success: { files: ['a.md'], totalFiles: 1 } },
            },
          },
        },
      ],
    };

    const nested = extractCursorNestedToolCalls(toolUseResult, 'parent-task');
    expect(nested).toHaveLength(1);
    expect(nested[0]).toMatchObject({
      id: 'parent-task:step:0',
      name: TOOL_GLOB,
      status: 'completed',
      result: expect.stringContaining('a.md'),
    });
  });
});

describe('CursorTaskResultInterpreter', () => {
  const interpreter = new CursorTaskResultInterpreter();

  it('treats sync conversationSteps as non-async launch markers', () => {
    expect(interpreter.hasAsyncLaunchMarker({
      agentId: 'agent-1',
      conversationSteps: [{ assistantMessage: { text: 'done' } }],
      isBackground: false,
    })).toBe(false);
  });

  it('treats agentId-only payloads as async launch markers', () => {
    expect(interpreter.hasAsyncLaunchMarker({ agentId: 'agent-1' })).toBe(true);
  });

  it('extracts the final assistantMessage text as structured result', () => {
    expect(interpreter.extractStructuredResult({
      conversationSteps: [
        { assistantMessage: { text: 'first' } },
        { assistantMessage: { text: 'final answer' } },
      ],
    })).toBe('final answer');
  });
});

describe('attachCursorSubagentToTaskToolCall', () => {
  it('hydrates subagent metadata and nested tools for history reload', () => {
    const toolCall: ToolCallInfo = {
      id: 'task-1',
      name: TOOL_SUBAGENT,
      input: { description: 'List core', prompt: 'go' },
      status: 'completed',
      result: 'src/core/CLAUDE.md',
    };

    attachCursorSubagentToTaskToolCall(toolCall, {
      taskToolCall: {
        result: {
          success: {
            conversationSteps: [
              {
                toolCall: {
                  globToolCall: {
                    args: { globPattern: '*.md' },
                    result: { success: { files: ['src/core/CLAUDE.md'], totalFiles: 1 } },
                  },
                },
              },
              { assistantMessage: { text: 'src/core/CLAUDE.md' } },
            ],
            isBackground: false,
          },
        },
      },
    });

    expect(toolCall.subagent).toBeDefined();
    expect(toolCall.subagent?.mode).toBe('sync');
    expect(toolCall.subagent?.toolCalls).toHaveLength(1);
    expect(toolCall.subagent?.toolCalls[0].name).toBe(TOOL_GLOB);
    expect(toolCall.subagent?.result).toBe('src/core/CLAUDE.md');
  });
});

describe('task tool normalization', () => {
  it('maps subagentType objects and builds task toolUseResult', () => {
    const start = normalizeCursorToolStart({
      kind: 'taskToolCall',
      args: {
        description: 'd',
        prompt: 'p',
        subagentType: { explore: {} },
      },
      result: undefined,
      description: undefined,
    });
    expect(start.input.subagent_type).toBe('explore');

    const completion = normalizeCursorToolCompletion({
      kind: 'taskToolCall',
      args: start.input,
      result: {
        success: {
          conversationSteps: [{ assistantMessage: { text: 'done' } }],
          isBackground: false,
        },
      },
      description: undefined,
    });
    expect(completion.content).toBe('done');
    expect(completion.toolUseResult).toMatchObject({
      conversationSteps: expect.any(Array),
    });
  });
});
