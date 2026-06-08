import { TOOL_ASK_USER_QUESTION } from '@/core/tools/toolNames';
import type { StreamChunk } from '@/core/types';
import {
  CURSOR_ASK_ANSWER_FOLLOWUP_NOTE,
  CursorAskUserQuestionInterceptState,
  isCursorAskUserQuestionSkippedResult,
} from '@/providers/cursor/runtime/cursorAskUserQuestion';
import { finalizeCursorAgentStream, processCursorAgentNdjsonLines } from '@/providers/cursor/runtime/cursorQueryProcessing';

import { SAMPLE_CURSOR_ASK_USER_QUESTION_STREAM_LINES } from '../../../../fixtures/providers/cursor/sampleAskUserQuestionStream';
import { SAMPLE_CURSOR_PLAN_TURN_STREAM_LINES } from '../../../../fixtures/providers/cursor/samplePlanTurnStream';

async function collectStreamChunks(
  lines: readonly string[],
  askCallback: ((input: Record<string, unknown>) => Promise<Record<string, string | string[]> | null>) | null,
  onAskUserAnswers?: (answers: Record<string, string | string[]>) => void,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  const stream = processCursorAgentNdjsonLines(async function* () {
    for (const line of lines) {
      yield line;
    }
  }(), {
    askCallback,
    isPlanTurn: false,
    isCanceled: () => false,
    onAskUserAnswers,
  });

  let next = await stream.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await stream.next();
  }
  return chunks;
}

describe('Cursor ask-user NDJSON pipeline fixture', () => {
  it('marks the tool block neutral and surfaces answers for the follow-up turn', async () => {
    const callback = jest.fn().mockResolvedValue({ 'Pick a focus': 'Cursor parity' });
    const onAskUserAnswers = jest.fn();
    const chunks = await collectStreamChunks(
      SAMPLE_CURSOR_ASK_USER_QUESTION_STREAM_LINES,
      callback,
      onAskUserAnswers,
    );

    expect(callback).toHaveBeenCalledTimes(1);
    expect(onAskUserAnswers).toHaveBeenCalledWith({ 'Pick a focus': 'Cursor parity' });
    const toolUse = chunks.find((c) => c.type === 'tool_use');
    const toolResult = chunks.find((c) => c.type === 'tool_result');
    expect(toolUse).toMatchObject({ name: TOOL_ASK_USER_QUESTION, id: 'call-ask-1' });
    expect(toolResult).toMatchObject({
      id: 'call-ask-1',
      isError: false,
      content: CURSOR_ASK_ANSWER_FOLLOWUP_NOTE,
    });
    expect(isCursorAskUserQuestionSkippedResult(String(toolResult?.content))).toBe(false);
  });

  it('keeps skipped result and surfaces no answers when the user declines', async () => {
    const onAskUserAnswers = jest.fn();
    const chunks = await collectStreamChunks(
      SAMPLE_CURSOR_ASK_USER_QUESTION_STREAM_LINES,
      jest.fn().mockResolvedValue(null),
      onAskUserAnswers,
    );
    const toolResult = chunks.find((c) => c.type === 'tool_result');
    expect(onAskUserAnswers).not.toHaveBeenCalled();
    expect(toolResult).toBeDefined();
    expect(isCursorAskUserQuestionSkippedResult(String(toolResult?.content))).toBe(true);
  });

  it('handles two ask-user tools in one turn with shared intercept state', async () => {
    const state = new CursorAskUserQuestionInterceptState();
    const callback = jest.fn()
      .mockResolvedValueOnce({ Q1: 'A' })
      .mockResolvedValueOnce({ Q2: 'B' });
    const onAnswers = jest.fn();

    const batches: StreamChunk[][] = [
      [{
        type: 'tool_use',
        id: 'a1',
        name: TOOL_ASK_USER_QUESTION,
        input: { questions: [{ question: 'Q1', options: [{ label: 'A' }] }] },
      }],
      [{
        type: 'tool_result',
        id: 'a1',
        content: JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
        isError: true,
      }],
      [{
        type: 'tool_use',
        id: 'a2',
        name: TOOL_ASK_USER_QUESTION,
        input: { questions: [{ question: 'Q2', options: [{ label: 'B' }] }] },
      }],
      [{
        type: 'tool_result',
        id: 'a2',
        content: JSON.stringify({ rejected: { reason: 'Questions skipped by user' } }),
        isError: true,
      }],
    ];

    const out: StreamChunk[] = [];
    for (const batch of batches) {
      for await (const chunk of state.interceptChunks(batch, callback, undefined, onAnswers)) {
        out.push(chunk);
      }
    }

    expect(onAnswers.mock.calls).toEqual([[{ Q1: 'A' }], [{ Q2: 'B' }]]);
    expect(out.filter((c) => c.type === 'tool_result')).toEqual([
      expect.objectContaining({ id: 'a1', content: CURSOR_ASK_ANSWER_FOLLOWUP_NOTE, isError: false }),
      expect.objectContaining({ id: 'a2', content: CURSOR_ASK_ANSWER_FOLLOWUP_NOTE, isError: false }),
    ]);
  });
});

describe('Cursor plan turn NDJSON pipeline fixture', () => {
  it('sets planCompleted metadata after CreatePlan succeeds', async () => {
    const chunks: StreamChunk[] = [];
    const sessionIds: string[] = [];
    const stream = processCursorAgentNdjsonLines(async function* () {
      for (const line of SAMPLE_CURSOR_PLAN_TURN_STREAM_LINES) {
        yield line;
      }
    }(), {
      askCallback: null,
      isPlanTurn: true,
      isCanceled: () => false,
      onSessionId: (id) => { sessionIds.push(id); },
    });

    let next = await stream.next();
    while (!next.done) {
      chunks.push(next.value);
      next = await stream.next();
    }
    const tracker = next.value;

    const { turnMetadata } = finalizeCursorAgentStream(tracker, true, {
      canceled: false,
      sawDone: chunks.some((c) => c.type === 'done'),
      exitCode: 0,
      stderr: '',
    });

    expect(sessionIds).toContain('plan-fixture-session');
    expect(turnMetadata).toEqual({ planCompleted: true });
  });
});
