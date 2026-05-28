// Mirrors cursor-agent --stream-partial-output: per-line text fragments, then one full snapshot.
// Pattern taken from .context/cursor-stream-tools.ndjson (post-tool assistant tail).
export const SAMPLE_CURSOR_PARTIAL_ASSISTANT_STREAM_LINES: readonly string[] = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    model: 'auto',
    session_id: 'fixture-partial-session',
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-partial-session',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Shell' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-partial-session',
    message: { role: 'assistant', content: [{ type: 'text', text: ' output' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-partial-session',
    message: { role: 'assistant', content: [{ type: 'text', text: ': `hello`' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'fixture-partial-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Shell output: `hello`' }],
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'fixture-partial-session',
    result: 'Shell output: `hello`',
    usage: { inputTokens: 1, outputTokens: 2 },
  }),
];
