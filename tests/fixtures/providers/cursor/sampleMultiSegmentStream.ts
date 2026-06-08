// Captured live from `cursor-agent -p --output-format stream-json
// --stream-partial-output` for a prompt that interleaves three text segments
// with two tool calls (raw capture in .context/stream-capture/multi.ndjson).
//
// The load-bearing shape: within each segment the CLI streams pure delta
// fragments, then emits ONE cumulative snapshot of that segment only. The
// snapshot is segment-local — it never re-includes text from an earlier
// segment that was already closed by a tool call. The third segment's body is
// shortened here for readability; the streaming/snapshot structure is intact.
export const SAMPLE_CURSOR_MULTI_SEGMENT_STREAM_LINES: readonly string[] = [
  JSON.stringify({ type: 'system', subtype: 'init', model: 'auto', session_id: 'fixture-multi-session' }),
  JSON.stringify({ type: 'user', session_id: 'fixture-multi-session' }),

  // Segment 1: fragments, then a segment-local snapshot.
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: 'I' }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: "'ll work" }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: ' through these steps in' }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: ' order.\n\nALPHA' }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: "I'll work through these steps in order.\n\nALPHA" }] } }),

  // Tool call 1 closes segment 1.
  JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: 'ls-1', session_id: 'fixture-multi-session', tool_call: { lsToolCall: { args: {} } } }),
  JSON.stringify({ type: 'tool_call', subtype: 'completed', call_id: 'ls-1', session_id: 'fixture-multi-session', tool_call: { lsToolCall: { args: {}, result: { success: {} } } } }),

  // Segment 2: fragments, then a snapshot equal ONLY to this segment ("BETA").
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: 'B' }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: 'ETA' }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: 'BETA' }] } }),

  // Tool call 2 closes segment 2.
  JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: 'pwd-1', session_id: 'fixture-multi-session', tool_call: { shellToolCall: { args: { command: 'pwd' } } } }),
  JSON.stringify({ type: 'tool_call', subtype: 'completed', call_id: 'pwd-1', session_id: 'fixture-multi-session', tool_call: { shellToolCall: { args: { command: 'pwd' }, result: { success: {} } } } }),

  // Segment 3: fragments, then a segment-local snapshot.
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: 'The `pwd`' }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: ' command output.' }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: ' GAMMA' }] } }),
  JSON.stringify({ type: 'assistant', session_id: 'fixture-multi-session', message: { role: 'assistant', content: [{ type: 'text', text: 'The `pwd` command output. GAMMA' }] } }),

  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'fixture-multi-session' }),
];
