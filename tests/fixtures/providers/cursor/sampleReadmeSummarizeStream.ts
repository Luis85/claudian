// Pattern from an early cursor-agent build: a pre-tool line doubled via a
// cumulative snapshot (segment re-sent after a newline), then a tool call, then
// a fresh post-tool segment with its own snapshot. Exercises the reducer's
// exact-repeat dedupe plus segment closing on tool calls.
export const SAMPLE_CURSOR_README_SUMMARIZE_STREAM_LINES: readonly string[] = [
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-readme-session',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Reading the project README.' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-readme-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Reading the project README.\nReading the project README.' }],
    },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'glob-1',
    session_id: 'fixture-readme-session',
    tool_call: { globToolCall: { args: { globPattern: 'README*' } } },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'glob-1',
    session_id: 'fixture-readme-session',
    tool_call: {
      globToolCall: {
        args: { globPattern: 'README*' },
        result: { success: { files: ['README.md'], totalFiles: 1 } },
      },
    },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-readme-session',
    message: { role: 'assistant', content: [{ type: 'text', text: '## Summary\n\nShort README summary.' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-readme-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '## Summary\n\nShort README summary.' }],
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'fixture-readme-session',
  }),
];
