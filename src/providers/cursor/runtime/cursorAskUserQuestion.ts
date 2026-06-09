import type { AskUserQuestionCallback } from '../../../core/runtime/types';
import { TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type { StreamChunk } from '../../../core/types';

/**
 * Marks the question's tool block once the user has answered. The answer itself
 * is NOT folded in here — it is delivered to the agent as a resumed follow-up
 * turn (see {@link buildCursorAnswerFollowUpPrompt}). Worded conditionally
 * because delivery is decided later: a plan Revise/Cancel suppresses the
 * follow-up, so the marker must not record a send that never happened.
 */
export const CURSOR_ASK_ANSWER_FOLLOWUP_NOTE =
  'Answer collected; sent as a follow-up message when the conversation continues.';

export function isCursorAskUserQuestionSkippedResult(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  if (/skipped by user/i.test(trimmed)) {
    return true;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const rejected = parsed.rejected;
    if (rejected && typeof rejected === 'object') {
      const reason = (rejected as Record<string, unknown>).reason;
      return typeof reason === 'string' && /skipped/i.test(reason);
    }
  } catch {
    // Not JSON — rely on substring checks above.
  }

  return false;
}

/** One answered question, label = displayed prompt text (see {@link resolveCursorAnswerLabels}). */
export interface CursorLabeledAnswer {
  label: string;
  answer: string | string[];
}

/**
 * Formats collected answers into the prompt for the resumed follow-up turn.
 * cursor-agent's `--print` CLI is one-shot and auto-rejects AskUserQuestion, so
 * the answer can only reach the agent as the next (resumed) user message.
 */
export function buildCursorAnswerFollowUpPrompt(answers: CursorLabeledAnswer[]): string {
  const lines = answers.map(({ label, answer }) => {
    const formatted = Array.isArray(answer) ? answer.join(', ') : answer;
    return `- ${label}: ${formatted}`;
  });
  return `Here are my answers to your question(s):\n${lines.join('\n')}`;
}

/**
 * The inline widget keys answers by `question.id ?? question.question`, so when a
 * question carries an `id` the answer map is keyed by that opaque id. Re-key by
 * the displayed question text (from the original tool input) so the resumed
 * follow-up reads `- Pick a focus: A`, not `- focus: A`. Returns an ordered list
 * rather than a text-keyed map so two questions sharing the same prompt text but
 * distinct ids each keep their own answer instead of one overwriting the other.
 */
export function resolveCursorAnswerLabels(
  answers: Record<string, string | string[]>,
  input: Record<string, unknown> | undefined,
): CursorLabeledAnswer[] {
  const questions = Array.isArray(input?.questions) ? (input!.questions as unknown[]) : [];
  const textByKey = new Map<string, string>();
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const record = q as Record<string, unknown>;
    const text = typeof record.question === 'string' ? record.question : undefined;
    if (!text) continue;
    const key = typeof record.id === 'string' && record.id ? record.id : text;
    textByKey.set(key, text);
  }

  return Object.entries(answers).map(([key, answer]) => ({
    label: textByKey.get(key) ?? key,
    answer,
  }));
}

function hasUsableAskUserAnswers(
  answers: Record<string, string | string[]> | null | undefined,
): boolean {
  return !!answers && Object.keys(answers).length > 0;
}

/**
 * Holds ask-user state across NDJSON lines (tool_use and tool_result arrive separately).
 * Answered questions accumulate in {@link collectedAnswers} for the runtime to
 * deliver as the resumed follow-up turn.
 */
export class CursorAskUserQuestionInterceptState {
  readonly collectedAnswers: CursorLabeledAnswer[] = [];
  private readonly pendingInput = new Map<string, Record<string, unknown>>();
  private readonly resolvedAnswers = new Map<string, Record<string, string | string[]> | null>();

  reset(): void {
    this.pendingInput.clear();
    this.resolvedAnswers.clear();
    this.collectedAnswers.length = 0;
  }

  async *interceptChunks(
    chunks: StreamChunk[],
    callback: AskUserQuestionCallback | null,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    if (!callback) {
      for (const chunk of chunks) {
        yield chunk;
      }
      return;
    }

    for (const chunk of chunks) {
      if (chunk.type === 'tool_use' && chunk.name === TOOL_ASK_USER_QUESTION) {
        this.pendingInput.set(chunk.id, chunk.input);
        yield chunk;
        const answers = await callback(chunk.input, signal);
        this.resolvedAnswers.set(chunk.id, answers);
        continue;
      }

      if (chunk.type === 'tool_result' && this.pendingInput.has(chunk.id)) {
        const answers = this.resolvedAnswers.get(chunk.id);
        const questionInput = this.pendingInput.get(chunk.id);
        this.pendingInput.delete(chunk.id);
        this.resolvedAnswers.delete(chunk.id);

        if (hasUsableAskUserAnswers(answers)) {
          // The agent's one-shot CLI already skipped the tool, so the answer is
          // delivered as a resumed follow-up turn (the runtime builds it from
          // these answers). Replace the misleading "skipped by user" result with
          // a neutral marker instead of pretending the tool was answered in-turn.
          this.collectedAnswers.push(...resolveCursorAnswerLabels(answers!, questionInput));
          yield {
            type: 'tool_result',
            id: chunk.id,
            content: CURSOR_ASK_ANSWER_FOLLOWUP_NOTE,
            isError: false,
          };
          continue;
        }

        // CLI skipped or user declined — pass through (often isCursorAskUserQuestionSkippedResult).
        yield chunk;
        continue;
      }

      yield chunk;
    }
  }
}
