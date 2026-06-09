import type { ChatTurnMetadata } from '../../../core/runtime/types';
import type { StreamChunk } from '../../../core/types';
import type { CursorLabeledAnswer } from './cursorAskUserQuestion';

export interface CursorQueryChunkTracker {
  pendingToolNames: Map<string, string>;
  sawPlanToolComplete: boolean;
  sawDone: boolean;
  /** Answered AskUserQuestion entries, delivered by the runtime as a resumed follow-up turn. */
  askUserAnswers: CursorLabeledAnswer[];
}

export function createCursorQueryChunkTracker(): CursorQueryChunkTracker {
  return {
    pendingToolNames: new Map(),
    sawPlanToolComplete: false,
    sawDone: false,
    askUserAnswers: [],
  };
}

export function observeCursorStreamChunk(
  chunk: StreamChunk,
  tracker: CursorQueryChunkTracker,
): void {
  if (chunk.type === 'tool_use') {
    tracker.pendingToolNames.set(chunk.id, chunk.name);
    return;
  }
  if (chunk.type === 'tool_result' && !chunk.isError) {
    const toolName = tracker.pendingToolNames.get(chunk.id);
    if (toolName === 'CreatePlan') {
      tracker.sawPlanToolComplete = true;
    }
    return;
  }
  if (chunk.type === 'done') {
    tracker.sawDone = true;
  }
}

export function getCursorPlanTurnMetadata(
  isPlanTurn: boolean,
  tracker: CursorQueryChunkTracker,
): ChatTurnMetadata {
  if (isPlanTurn && tracker.sawPlanToolComplete) {
    return { planCompleted: true };
  }
  return {};
}

export interface CursorQueryCompletionInput {
  canceled: boolean;
  sawDone: boolean;
  exitCode: number | null;
  stderr: string;
}

/** Terminal chunks after the CLI process exits (errors / missing result). */
export function* emitCursorQueryCompletionChunks(
  input: CursorQueryCompletionInput,
): Generator<StreamChunk> {
  if (input.canceled) {
    if (!input.sawDone) {
      yield { type: 'done' };
    }
    return;
  }

  if (input.exitCode !== 0) {
    if (!input.sawDone) {
      const msg = input.stderr.trim() || `Cursor Agent exited with code ${input.exitCode}`;
      yield { type: 'error', content: msg };
      yield { type: 'done' };
    }
    return;
  }

  if (!input.sawDone) {
    yield {
      type: 'error',
      content: input.stderr.trim() || 'Cursor Agent finished without a terminal result event',
    };
    yield { type: 'done' };
  }
}
