// Redacted NDJSON lines from a single Cursor tool-using turn (read → edit).
// Used to lock stream→StreamChunk mapping without spawning cursor-agent in CI.
export const SAMPLE_CURSOR_TOOL_TURN_STREAM_LINES: readonly string[] = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    model: 'composer-2.5',
    session_id: 'fixture-session',
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'I will read the file first.' }],
    },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'call-read-1',
    session_id: 'fixture-session',
    tool_call: { readToolCall: { args: { path: 'README.md' } } },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'call-read-1',
    session_id: 'fixture-session',
    tool_call: {
      readToolCall: {
        args: { path: 'README.md' },
        result: { success: { content: '# Hello' } },
      },
    },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'I will read the file first.\n\nNow I will edit it.' }],
    },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'call-edit-1',
    session_id: 'fixture-session',
    tool_call: {
      editToolCall: { args: { path: 'README.md', streamContent: '# Hello World' } },
    },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'call-edit-1',
    session_id: 'fixture-session',
    tool_call: {
      editToolCall: {
        args: { path: 'README.md', streamContent: '# Hello World' },
        result: {
          success: {
            path: 'README.md',
            message: 'Updated README.md',
            diffString: '@@ -1 +1 @@\n-# Hello\n+# Hello World',
          },
        },
      },
    },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-session',
    message: {
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'I will read the file first.\n\nNow I will edit it.\n\nDone.',
      }],
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    session_id: 'fixture-session',
    is_error: false,
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }),
];
