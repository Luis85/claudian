import {
  computeCursorAssistantTextDelta,
  CursorNdjsonStreamReducer,
} from '@/providers/cursor/runtime/cursorStreamMapper';

import { SAMPLE_CURSOR_MULTI_SEGMENT_STREAM_LINES } from '../../../../fixtures/providers/cursor/sampleMultiSegmentStream';
import { SAMPLE_CURSOR_PARTIAL_ASSISTANT_STREAM_LINES } from '../../../../fixtures/providers/cursor/samplePartialAssistantStream';
import { SAMPLE_CURSOR_README_SUMMARIZE_STREAM_LINES } from '../../../../fixtures/providers/cursor/sampleReadmeSummarizeStream';

function textFromStream(lines: readonly string[]): string {
  const reducer = new CursorNdjsonStreamReducer();
  const textChunks: string[] = [];
  for (const line of lines) {
    for (const chunk of reducer.reduceLine(line).chunks) {
      if (chunk.type === 'text') {
        textChunks.push(chunk.content);
      }
    }
  }
  return textChunks.join('');
}

describe('computeCursorAssistantTextDelta', () => {
  it('appends stream-partial fragments and ignores the final cumulative snapshot', () => {
    let acc = '';
    const fragments = ['Shell', ' output', ': `hello`'];
    const emitted: string[] = [];

    for (const fragment of fragments) {
      const { delta, next } = computeCursorAssistantTextDelta(acc, fragment);
      acc = next;
      if (delta) emitted.push(delta);
    }

    expect(emitted.join('')).toBe('Shell output: `hello`');

    const final = computeCursorAssistantTextDelta(acc, 'Shell output: `hello`');
    expect(final.delta).toBe('');
    expect(final.next).toBe('Shell output: `hello`');
  });

  it('skips a repeated cumulative prefix extension already present in accumulated text', () => {
    const acc = 'Reading the project README.\n';
    const incoming = 'Reading the project README.\nReading the project README.\n';
    const { delta } = computeCursorAssistantTextDelta(acc, incoming);
    expect(delta).toBe('');
  });

  it('skips a repeated line when cumulative text re-sends it after only a newline', () => {
    const acc = 'Reading the project README.';
    const incoming = 'Reading the project README.\nReading the project README.';
    const { delta } = computeCursorAssistantTextDelta(acc, incoming);
    expect(delta).toBe('');
  });

  it('ignores a doubled cumulative snapshot pasted back-to-back without a separator', () => {
    const opening =
      'Here is a review of Claudian\'s Cursor integration against the CLI on this machine.\n\n'
      + 'Your machine\n\nOverall the integration is well-architected and largely correct. '
      + 'I can turn any of these into concrete patches — the spawn-error handler and '
      + 'binary-discovery expansion are the smallest high-value fixes.';
    const doubled = `${opening}${opening}`;

    const { delta, next } = computeCursorAssistantTextDelta(opening, doubled);

    expect(delta).toBe('');
    expect(next).toBe(opening);
  });

  it('appends fragments verbatim without guessing segment boundaries from prose', () => {
    // The single-string shim cannot see tool calls, so it must not infer a new
    // segment from capitalization/punctuation (the old fragile heuristic). It
    // simply appends. Real segment boundaries are handled by the reducer when a
    // tool call arrives (see the reducer fixtures below).
    let acc = 'Delegating to a subagent.\n';
    const postToolFragments = ['The', ' answer', ' is 42.'];
    const emitted: string[] = [];

    for (const fragment of postToolFragments) {
      const { delta, next } = computeCursorAssistantTextDelta(acc, fragment);
      acc = next;
      if (delta) emitted.push(delta);
    }

    expect(emitted.join('')).toBe('The answer is 42.');
    expect(acc).toBe('Delegating to a subagent.\nThe answer is 42.');
  });
});

describe('CursorNdjsonStreamReducer partial assistant fixture', () => {
  it('does not duplicate assistant text for partial NDJSON plus final snapshot', () => {
    const reducer = new CursorNdjsonStreamReducer();
    const textChunks: string[] = [];

    for (const line of SAMPLE_CURSOR_PARTIAL_ASSISTANT_STREAM_LINES) {
      const { chunks } = reducer.reduceLine(line);
      for (const chunk of chunks) {
        if (chunk.type === 'text') {
          textChunks.push(chunk.content);
        }
      }
    }

    expect(textChunks.join('')).toBe('Shell output: `hello`');
  });

  it('does not duplicate when reducer receives a doubled cumulative assistant row', () => {
    const opening =
      'Here is a review of Claudian\'s Cursor integration against the CLI on this machine.\n\n'
      + 'Your machine\n\nOverall the integration is well-architected and largely correct. '
      + 'I can turn any of these into concrete patches — the spawn-error handler and '
      + 'binary-discovery expansion are the smallest high-value fixes.';
    const doubled = `${opening}${opening}`;
    const reducer = new CursorNdjsonStreamReducer();
    const textChunks: string[] = [];

    for (const line of [
      JSON.stringify({
        type: 'system',
        model: 'auto',
        session_id: 'fixture-doubled-session',
      }),
      JSON.stringify({
        type: 'assistant',
        session_id: 'fixture-doubled-session',
        message: { role: 'assistant', content: [{ type: 'text', text: opening }] },
      }),
      JSON.stringify({
        type: 'assistant',
        session_id: 'fixture-doubled-session',
        message: { role: 'assistant', content: [{ type: 'text', text: doubled }] },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'fixture-doubled-session',
      }),
    ]) {
      const { chunks } = reducer.reduceLine(line);
      for (const chunk of chunks) {
        if (chunk.type === 'text') {
          textChunks.push(chunk.content);
        }
      }
    }

    expect(textChunks.join('')).toBe(opening);
    expect(textChunks.join('').match(/Here is a review/g)?.length).toBe(1);
  });

  it('does not duplicate pre-tool or post-tool assistant text on a readme summarize turn', () => {
    const text = textFromStream(SAMPLE_CURSOR_README_SUMMARIZE_STREAM_LINES);
    expect(text).toBe('Reading the project README.## Summary\n\nShort README summary.');
    expect(text.match(/Reading the project README\./g)?.length).toBe(1);
    expect(text.match(/Short README summary\./g)?.length).toBe(1);
  });

  // Captured live from cursor-agent --stream-partial-output (3 text segments,
  // 2 tool calls). Each segment streams pure delta fragments then closes with a
  // segment-local cumulative snapshot; snapshots are NOT cumulative across the
  // whole turn. This is the contract the reducer must honor without heuristics.
  it('reconstructs a multi-segment, multi-tool turn exactly once', () => {
    const text = textFromStream(SAMPLE_CURSOR_MULTI_SEGMENT_STREAM_LINES);
    expect(text).toBe(
      "I'll work through these steps in order.\n\nALPHA"
      + 'BETA'
      + 'The `pwd` command output. GAMMA',
    );
    expect(text.match(/ALPHA/g)?.length).toBe(1);
    expect(text.match(/BETA/g)?.length).toBe(1);
    expect(text.match(/GAMMA/g)?.length).toBe(1);
  });

  it('treats a post-tool segment snapshot as segment-local, not whole-turn cumulative', () => {
    // Pre-tool segment "ALPHA" must not be re-prefixed onto the post-tool
    // segment snapshot "BETA"; the post-tool snapshot equals only "BETA".
    const lines = [
      JSON.stringify({ type: 'system', model: 'auto', session_id: 's' }),
      JSON.stringify({ type: 'assistant', session_id: 's', message: { role: 'assistant', content: [{ type: 'text', text: 'ALPHA' }] } }),
      JSON.stringify({ type: 'assistant', session_id: 's', message: { role: 'assistant', content: [{ type: 'text', text: 'ALPHA' }] } }),
      JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: 't1', session_id: 's', tool_call: { lsToolCall: { args: {} } } }),
      JSON.stringify({ type: 'tool_call', subtype: 'completed', call_id: 't1', session_id: 's', tool_call: { lsToolCall: { args: {}, result: { success: {} } } } }),
      JSON.stringify({ type: 'assistant', session_id: 's', message: { role: 'assistant', content: [{ type: 'text', text: 'BETA' }] } }),
      JSON.stringify({ type: 'assistant', session_id: 's', message: { role: 'assistant', content: [{ type: 'text', text: 'BETA' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's' }),
    ];
    expect(textFromStream(lines)).toBe('ALPHABETA');
  });
});
