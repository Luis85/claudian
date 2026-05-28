import type { AskUserQuestionCallback } from '../../../core/runtime/types';
import { TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type { StreamChunk } from '../../../core/types';

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

export interface CursorAskUserQuestionToolResultPayload {
  content: string;
  toolUseResult: { answers: Record<string, string | string[]> };
}

export function buildCursorAskUserQuestionToolResult(
  answers: Record<string, string | string[]>,
): CursorAskUserQuestionToolResultPayload {
  const lines = Object.entries(answers).map(([question, answer]) => {
    const formatted = Array.isArray(answer) ? answer.join(', ') : answer;
    return `${question}: ${formatted}`;
  });
  return {
    content: lines.join('\n'),
    toolUseResult: { answers },
  };
}

function hasUsableAskUserAnswers(
  answers: Record<string, string | string[]> | null | undefined,
): boolean {
  return !!answers && Object.keys(answers).length > 0;
}

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
          const built = buildCursorAskUserQuestionToolResult(answers!);
          yield {
            type: 'tool_result',
            id: chunk.id,
            content: built.content,
            toolUseResult: built.toolUseResult,
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

/**
 * When the Cursor CLI cannot prompt in Obsidian it returns "skipped by user".
 * Pause on tool_use, collect answers via Claudian UI, and replace the CLI result.
 *
 * @deprecated Prefer {@link CursorAskUserQuestionInterceptState} for multi-line NDJSON streams.
 */
export async function* interceptCursorAskUserQuestionChunks(
  chunks: StreamChunk[],
  callback: AskUserQuestionCallback | null,
  signal?: AbortSignal,
  state: CursorAskUserQuestionInterceptState = new CursorAskUserQuestionInterceptState(),
): AsyncGenerator<StreamChunk> {
  yield* state.interceptChunks(chunks, callback, signal);
}
