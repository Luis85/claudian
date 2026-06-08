import type { AskUserQuestionCallback } from '../../../core/runtime/types';
import { TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type { StreamChunk } from '../../../core/types';

/**
 * Marks the question's tool block once the user has answered. The answer itself
 * is NOT folded in here — it is delivered to the agent as a resumed follow-up
 * turn (see {@link buildCursorAnswerFollowUpPrompt}), so the tool result only
 * records that the out-of-band answer was sent.
 */
export const CURSOR_ASK_ANSWER_FOLLOWUP_NOTE = 'Answer sent as a follow-up message.';

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

/**
 * Formats collected answers into the prompt for the resumed follow-up turn.
 * cursor-agent's `--print` CLI is one-shot and auto-rejects AskUserQuestion, so
 * the answer can only reach the agent as the next (resumed) user message.
 */
export function buildCursorAnswerFollowUpPrompt(
  answers: Record<string, string | string[]>,
): string {
  const lines = Object.entries(answers).map(([question, answer]) => {
    const formatted = Array.isArray(answer) ? answer.join(', ') : answer;
    return `- ${question}: ${formatted}`;
  });
  return `Here are my answers to your question(s):\n${lines.join('\n')}`;
}

function hasUsableAskUserAnswers(
  answers: Record<string, string | string[]> | null | undefined,
): boolean {
  return !!answers && Object.keys(answers).length > 0;
}

export type CursorAskUserAnswersListener = (
  answers: Record<string, string | string[]>,
) => void;

/**
 * Holds ask-user state across NDJSON lines (tool_use and tool_result arrive separately).
 */
export class CursorAskUserQuestionInterceptState {
  private readonly pendingInput = new Map<string, Record<string, unknown>>();
  private readonly resolvedAnswers = new Map<string, Record<string, string | string[]> | null>();

  reset(): void {
    this.pendingInput.clear();
    this.resolvedAnswers.clear();
  }

  async *interceptChunks(
    chunks: StreamChunk[],
    callback: AskUserQuestionCallback | null,
    signal?: AbortSignal,
    onAnswers?: CursorAskUserAnswersListener,
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
        this.pendingInput.delete(chunk.id);
        this.resolvedAnswers.delete(chunk.id);

        if (hasUsableAskUserAnswers(answers)) {
          // The agent's one-shot CLI already skipped the tool, so the answer is
          // delivered as a resumed follow-up turn (the runtime builds it from
          // these answers). Replace the misleading "skipped by user" result with
          // a neutral marker instead of pretending the tool was answered in-turn.
          onAnswers?.(answers!);
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
