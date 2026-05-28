import { TOOL_ASK_USER_QUESTION } from '@/core/tools/toolNames';
import type { StreamChunk } from '@/core/types';
import {
  buildCursorAskUserQuestionToolResult,
  CursorAskUserQuestionInterceptState,
  interceptCursorAskUserQuestionChunks,
  isCursorAskUserQuestionSkippedResult,
} from '@/providers/cursor/runtime/cursorAskUserQuestion';

describe('cursorAskUserQuestion', () => {
  it('detects Cursor skipped-question payloads', () => {
    expect(isCursorAskUserQuestionSkippedResult(
      JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
    )).toBe(true);
    expect(isCursorAskUserQuestionSkippedResult('User answered')).toBe(false);
  });

  it('builds tool results with structured answers', () => {
    const built = buildCursorAskUserQuestionToolResult({
      'Next focus': 'Trust foundation',
    });
    expect(built.content).toContain('Next focus: Trust foundation');
    expect(built.toolUseResult).toEqual({
      answers: { 'Next focus': 'Trust foundation' },
    });
  });

  it('replaces skipped CLI results after collecting answers in Obsidian', async () => {
    const chunks: StreamChunk[] = [
      {
        type: 'tool_use',
        id: 'ask-1',
        name: TOOL_ASK_USER_QUESTION,
        input: {
          questions: [{
            question: 'Pick a focus',
            options: [{ label: 'A' }, { label: 'B' }],
          }],
        },
      },
      {
        type: 'tool_result',
        id: 'ask-1',
        content: JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
        isError: true,
      },
    ];

    const callback = jest.fn().mockResolvedValue({ 'Pick a focus': 'A' });
    const out: StreamChunk[] = [];
    for await (const chunk of interceptCursorAskUserQuestionChunks(chunks, callback)) {
      out.push(chunk);
    }

    expect(callback).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      type: 'tool_result',
      id: 'ask-1',
      isError: false,
      content: 'Pick a focus: A',
      toolUseResult: { answers: { 'Pick a focus': 'A' } },
    });
  });

  it('replaces skipped results across separate chunk batches with shared state', async () => {
    const state = new CursorAskUserQuestionInterceptState();
    const callback = jest.fn().mockResolvedValue({ 'Pick a focus': 'A' });

    const started: StreamChunk[] = [{
      type: 'tool_use',
      id: 'ask-1',
      name: TOOL_ASK_USER_QUESTION,
      input: { questions: [{ question: 'Pick a focus', options: [{ label: 'A' }] }] },
    }];
    const completed: StreamChunk[] = [{
      type: 'tool_result',
      id: 'ask-1',
      content: JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
      isError: true,
    }];

    const out: StreamChunk[] = [];
    for await (const chunk of state.interceptChunks(started, callback)) {
      out.push(chunk);
    }
    for await (const chunk of state.interceptChunks(completed, callback)) {
      out.push(chunk);
    }

    expect(callback).toHaveBeenCalledTimes(1);
    expect(out[1]).toMatchObject({
      type: 'tool_result',
      id: 'ask-1',
      isError: false,
      content: 'Pick a focus: A',
    });
    const resultChunk = out[1];
    expect(resultChunk.type === 'tool_result' && isCursorAskUserQuestionSkippedResult(resultChunk.content)).toBe(false);
  });

  it('passes through empty answer objects', async () => {
    const chunks: StreamChunk[] = [
      {
        type: 'tool_use',
        id: 'ask-1',
        name: TOOL_ASK_USER_QUESTION,
        input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] },
      },
      {
        type: 'tool_result',
        id: 'ask-1',
        content: JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
        isError: true,
      },
    ];
    const callback = jest.fn().mockResolvedValue({});
    const out: StreamChunk[] = [];
    for await (const chunk of interceptCursorAskUserQuestionChunks(chunks, callback)) {
      out.push(chunk);
    }
    expect(out[1]).toEqual(chunks[1]);
  });

  it('aborts the ask callback when the signal fires', async () => {
    const controller = new AbortController();
    const callback = jest.fn((_input, signal) => new Promise<Record<string, string | string[]> | null>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new Error('aborted')));
      controller.abort();
    }));

    const chunks: StreamChunk[] = [{
      type: 'tool_use',
      id: 'ask-1',
      name: TOOL_ASK_USER_QUESTION,
      input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] },
    }];

    await expect((async () => {
      for await (const chunk of interceptCursorAskUserQuestionChunks(chunks, callback, controller.signal)) {
        void chunk;
      }
    })()).rejects.toThrow('aborted');
  });

  it('passes through when the user declines to answer', async () => {
    const rejected: StreamChunk = {
      type: 'tool_result',
      id: 'ask-1',
      content: JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
      isError: true,
    };
    const chunks: StreamChunk[] = [
      {
        type: 'tool_use',
        id: 'ask-1',
        name: TOOL_ASK_USER_QUESTION,
        input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] },
      },
      rejected,
    ];

    const callback = jest.fn().mockResolvedValue(null);
    const out: StreamChunk[] = [];
    for await (const chunk of interceptCursorAskUserQuestionChunks(chunks, callback)) {
      out.push(chunk);
    }

    expect(out[1]).toEqual(rejected);
  });
});
