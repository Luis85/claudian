import { TOOL_ASK_USER_QUESTION } from '@/core/tools/toolNames';
import type { StreamChunk } from '@/core/types';
import {
  buildCursorAnswerFollowUpPrompt,
  CURSOR_ASK_ANSWER_FOLLOWUP_NOTE,
  CursorAskUserQuestionInterceptState,
  isCursorAskUserQuestionSkippedResult,
  resolveCursorAnswerLabels,
} from '@/providers/cursor/runtime/cursorAskUserQuestion';

type AskCallback = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<Record<string, string | string[]> | null>;

async function runIntercept(
  chunks: StreamChunk[],
  callback: AskCallback,
  signal?: AbortSignal,
  state: CursorAskUserQuestionInterceptState = new CursorAskUserQuestionInterceptState(),
): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of state.interceptChunks(chunks, callback, signal)) {
    out.push(chunk);
  }
  return out;
}

describe('cursorAskUserQuestion', () => {
  it('detects Cursor skipped-question payloads', () => {
    expect(isCursorAskUserQuestionSkippedResult(
      JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
    )).toBe(true);
    expect(isCursorAskUserQuestionSkippedResult('User answered')).toBe(false);
  });

  it('formats collected answers into a resume follow-up prompt', () => {
    const prompt = buildCursorAnswerFollowUpPrompt([
      { label: 'Next focus', answer: 'Trust foundation' },
      { label: 'Scope', answer: ['A', 'B'] },
    ]);
    expect(prompt).toContain('- Next focus: Trust foundation');
    expect(prompt).toContain('- Scope: A, B');
  });

  it('re-keys id-keyed answers back to the displayed question text', () => {
    const labeled = resolveCursorAnswerLabels(
      { focus: 'A', plain: 'B' },
      { questions: [
        { id: 'focus', question: 'Pick a focus' },
        { question: 'plain' },
      ] },
    );
    // id-keyed answers resolve to prompt text; un-mapped keys pass through.
    expect(labeled).toEqual([
      { label: 'Pick a focus', answer: 'A' },
      { label: 'plain', answer: 'B' },
    ]);
  });

  it('keeps answers distinct when two questions share the same prompt text', () => {
    // Distinct ids, identical displayed text — must not collapse to one answer.
    const labeled = resolveCursorAnswerLabels(
      { a: 'X', b: 'Y' },
      { questions: [
        { id: 'a', question: 'Which file?' },
        { id: 'b', question: 'Which file?' },
      ] },
    );
    expect(labeled).toEqual([
      { label: 'Which file?', answer: 'X' },
      { label: 'Which file?', answer: 'Y' },
    ]);
    expect(buildCursorAnswerFollowUpPrompt(labeled)).toBe(
      'Here are my answers to your question(s):\n- Which file?: X\n- Which file?: Y',
    );
  });

  it('surfaces answers re-keyed by question text when the question carries an id', async () => {
    const chunks: StreamChunk[] = [
      {
        type: 'tool_use',
        id: 'ask-1',
        name: TOOL_ASK_USER_QUESTION,
        input: { questions: [{ id: 'focus', question: 'Pick a focus', options: [{ label: 'A' }] }] },
      },
      {
        type: 'tool_result',
        id: 'ask-1',
        content: JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
        isError: true,
      },
    ];
    // The widget keys the answer by the question's id, not its text.
    const callback = jest.fn().mockResolvedValue({ focus: 'A' });
    const state = new CursorAskUserQuestionInterceptState();
    await runIntercept(chunks, callback, undefined, state);
    expect(state.collectedAnswers).toEqual([{ label: 'Pick a focus', answer: 'A' }]);
  });

  it('marks the tool block neutral and surfaces answers for a follow-up turn', async () => {
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
    const state = new CursorAskUserQuestionInterceptState();
    const out = await runIntercept(chunks, callback, undefined, state);

    expect(callback).toHaveBeenCalledTimes(1);
    // The answer is delivered out-of-band, never folded back into the card.
    expect(state.collectedAnswers).toEqual([{ label: 'Pick a focus', answer: 'A' }]);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      type: 'tool_result',
      id: 'ask-1',
      content: CURSOR_ASK_ANSWER_FOLLOWUP_NOTE,
      isError: false,
    });
    expect(out[1].type === 'tool_result' && isCursorAskUserQuestionSkippedResult(out[1].content)).toBe(false);
  });

  it('marks neutral across separate chunk batches with shared state', async () => {
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

    const out = await runIntercept(started, callback, undefined, state);
    out.push(...await runIntercept(completed, callback, undefined, state));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(state.collectedAnswers).toHaveLength(1);
    expect(out[1]).toMatchObject({
      type: 'tool_result',
      id: 'ask-1',
      isError: false,
      content: CURSOR_ASK_ANSWER_FOLLOWUP_NOTE,
    });
  });

  it('passes through empty answer objects without surfacing a follow-up', async () => {
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
    const state = new CursorAskUserQuestionInterceptState();
    const out = await runIntercept(chunks, callback, undefined, state);
    expect(state.collectedAnswers).toHaveLength(0);
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

    await expect(runIntercept(chunks, callback, controller.signal)).rejects.toThrow('aborted');
  });

  it('passes through the skipped result when the user declines to answer', async () => {
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
    const state = new CursorAskUserQuestionInterceptState();
    const out = await runIntercept(chunks, callback, undefined, state);

    expect(state.collectedAnswers).toHaveLength(0);
    expect(out[1]).toEqual(rejected);
  });
});
