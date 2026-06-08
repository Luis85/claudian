// Reconstructs the shell + glob tools turn originally captured in the
// (uncommitted) .context/cursor-stream-tools.ndjson from an early cursor-agent
// build. That build emitted a whole-turn cumulative snapshot after tools (the
// post-tool snapshot restated the pre-tool text, and sometimes doubled it).
// Newer builds emit segment-local snapshots instead (see sampleMultiSegmentStream).
// The reducer must handle BOTH: this fixture guards the whole-turn-cumulative
// path so the answer is still shown exactly once.
export const SAMPLE_CURSOR_TOOLS_STREAM_LINES: readonly string[] = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    model: 'auto',
    session_id: 'fixture-tools-session',
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-tools-session',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Shell output:' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-tools-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Shell output: `hello-cursor`' }],
    },
  }),
  // Doubled cumulative snapshot: the bug this fixture guards against.
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-tools-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Shell output: `hello-cursor`\nShell output: `hello-cursor`' }],
    },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'shell-1',
    session_id: 'fixture-tools-session',
    tool_call: { shellToolCall: { args: { command: 'echo hello-cursor' } } },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'shell-1',
    session_id: 'fixture-tools-session',
    tool_call: {
      shellToolCall: {
        args: { command: 'echo hello-cursor' },
        result: { success: { stdout: 'hello-cursor', exitCode: 0 } },
      },
    },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'glob-1',
    session_id: 'fixture-tools-session',
    tool_call: { globToolCall: { args: { globPattern: '*.json' } } },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'glob-1',
    session_id: 'fixture-tools-session',
    tool_call: {
      globToolCall: {
        args: { globPattern: '*.json' },
        result: { success: { files: ['versions.json', 'manifest.json'], totalFiles: 2 } },
      },
    },
  }),
  // Post-tool cumulative snapshot re-sends the pre-tool text, then adds the tail.
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-tools-session',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Shell output: `hello-cursor`\n\nTwo JSON files at the root:\n- `versions.json`\n- `manifest.json`',
        },
      ],
    },
  }),
  // Final identical cumulative snapshot.
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-tools-session',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Shell output: `hello-cursor`\n\nTwo JSON files at the root:\n- `versions.json`\n- `manifest.json`',
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'fixture-tools-session',
    result: 'Shell output: `hello-cursor`\n\nTwo JSON files at the root:\n- `versions.json`\n- `manifest.json`',
    usage: { inputTokens: 3, outputTokens: 9 },
  }),
];
