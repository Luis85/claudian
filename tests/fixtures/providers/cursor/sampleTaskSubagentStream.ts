// Sync Task completion with nested glob tool inside conversationSteps (from cursor-agent NDJSON).
export const SAMPLE_CURSOR_TASK_SUBAGENT_STREAM_LINES: readonly string[] = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    model: 'auto',
    session_id: 'fixture-task-session',
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'task-call-1',
    session_id: 'fixture-task-session',
    tool_call: {
      taskToolCall: {
        args: {
          description: 'List core',
          prompt: 'List markdown files',
          subagentType: { explore: {} },
          agentId: 'agent-fixture-1',
          mode: 'TASK_MODE_UNSPECIFIED',
        },
      },
    },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'task-call-1',
    session_id: 'fixture-task-session',
    tool_call: {
      taskToolCall: {
        args: {
          description: 'List core',
          prompt: 'List markdown files',
          subagentType: { explore: {} },
          agentId: 'agent-fixture-1',
        },
        result: {
          success: {
            conversationSteps: [
              {
                toolCall: {
                  globToolCall: {
                    args: { targetDirectory: '/vault', globPattern: '**/*.md' },
                    result: {
                      success: {
                        files: ['src/core/CLAUDE.md'],
                        totalFiles: 1,
                      },
                    },
                  },
                },
              },
              { assistantMessage: { text: 'src/core/CLAUDE.md' } },
            ],
            agentId: 'agent-fixture-1',
            isBackground: false,
          },
        },
      },
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'fixture-task-session',
    usage: { inputTokens: 1, outputTokens: 2 },
  }),
];
