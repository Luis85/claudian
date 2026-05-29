import {
  computeCursorAssistantTextDelta,
  CursorNdjsonStreamReducer,
} from '@/providers/cursor/runtime/cursorStreamMapper';

import { SAMPLE_CURSOR_PARTIAL_ASSISTANT_STREAM_LINES } from '../../../../fixtures/providers/cursor/samplePartialAssistantStream';
import { SAMPLE_CURSOR_README_SUMMARIZE_STREAM_LINES } from '../../../../fixtures/providers/cursor/sampleReadmeSummarizeStream';

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

  it('starts a new assistant segment after a completed paragraph when tools split the turn', () => {
    let acc = 'Delegating to a subagent.\n';
    const postToolFragments = ['The', ' answer', ' is 42.'];
    const emitted: string[] = [];

    for (const fragment of postToolFragments) {
      const { delta, next } = computeCursorAssistantTextDelta(acc, fragment);
      acc = next;
      if (delta) emitted.push(delta);
    }

    expect(emitted.join('')).toBe('The answer is 42.');
    expect(acc).toBe('The answer is 42.');
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

  it('does not duplicate pre-tool or post-tool assistant text on a readme summarize turn', () => {
    const reducer = new CursorNdjsonStreamReducer();
    const textChunks: string[] = [];

    for (const line of SAMPLE_CURSOR_README_SUMMARIZE_STREAM_LINES) {
      const { chunks } = reducer.reduceLine(line);
      for (const chunk of chunks) {
        if (chunk.type === 'text') {
          textChunks.push(chunk.content);
        }
      }
    }

    const text = textChunks.join('');
    expect(text).toBe('Reading the project README.## Summary\n\nShort README summary.');
    expect(text.match(/Reading the project README\./g)?.length).toBe(1);
    expect(text.match(/Short README summary\./g)?.length).toBe(1);
  });
});
