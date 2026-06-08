import type { AskUserQuestionCallback } from '../../../core/runtime/types';
import type { ChatTurnMetadata } from '../../../core/runtime/types';
import type { StreamChunk } from '../../../core/types';
import { type CursorAskUserAnswersListener, CursorAskUserQuestionInterceptState } from './cursorAskUserQuestion';
import {
  createCursorQueryChunkTracker,
  type CursorQueryChunkTracker,
  type CursorQueryCompletionInput,
  emitCursorQueryCompletionChunks,
  getCursorPlanTurnMetadata,
  observeCursorStreamChunk,
} from './cursorQueryLifecycle';
import { CursorNdjsonStreamReducer } from './cursorStreamMapper';

export interface ProcessCursorAgentStreamOptions {
  askCallback: AskUserQuestionCallback | null;
  askSignal?: AbortSignal;
  isPlanTurn: boolean;
  isCanceled: () => boolean;
  onSessionId?: (sessionId: string) => void;
  /** Fired with the labeled answers when an AskUserQuestion is answered (not declined). */
  onAskUserAnswers?: CursorAskUserAnswersListener;
}

export async function* processCursorAgentNdjsonLines(
  lines: AsyncIterable<string>,
  options: ProcessCursorAgentStreamOptions,
): AsyncGenerator<StreamChunk, CursorQueryChunkTracker> {
  const reducer = new CursorNdjsonStreamReducer();
  const chunkTracker = createCursorQueryChunkTracker();
  const askIntercept = new CursorAskUserQuestionInterceptState();

  for await (const line of lines) {
    if (options.isCanceled()) {
      break;
    }
    const { chunks, sessionId } = reducer.reduceLine(line);
    if (sessionId) {
      options.onSessionId?.(sessionId);
    }
    for await (const chunk of askIntercept.interceptChunks(
      chunks,
      options.askCallback,
      options.askSignal,
      options.onAskUserAnswers,
    )) {
      observeCursorStreamChunk(chunk, chunkTracker);
      yield chunk;
    }
  }

  return chunkTracker;
}

export function finalizeCursorAgentStream(
  chunkTracker: CursorQueryChunkTracker,
  isPlanTurn: boolean,
  completion: CursorQueryCompletionInput,
): { completionChunks: StreamChunk[]; turnMetadata: ChatTurnMetadata } {
  return {
    completionChunks: [...emitCursorQueryCompletionChunks(completion)],
    turnMetadata: getCursorPlanTurnMetadata(isPlanTurn, chunkTracker),
  };
}
