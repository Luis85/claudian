import {
  createCursorQueryChunkTracker,
  emitCursorQueryCompletionChunks,
  getCursorPlanTurnMetadata,
  observeCursorStreamChunk,
} from '@/providers/cursor/runtime/cursorQueryLifecycle';

describe('cursorQueryLifecycle', () => {
  it('tracks CreatePlan completion for plan turns', () => {
    const tracker = createCursorQueryChunkTracker();
    observeCursorStreamChunk(
      { type: 'tool_use', id: 'p1', name: 'CreatePlan', input: {} },
      tracker,
    );
    observeCursorStreamChunk(
      { type: 'tool_result', id: 'p1', content: 'ok' },
      tracker,
    );
    expect(getCursorPlanTurnMetadata(true, tracker)).toEqual({ planCompleted: true });
    expect(getCursorPlanTurnMetadata(false, tracker)).toEqual({});
  });

  it('emits done when canceled without a terminal result', () => {
    const chunks = [...emitCursorQueryCompletionChunks({
      canceled: true,
      sawDone: false,
      exitCode: 0,
      stderr: '',
    })];
    expect(chunks).toEqual([{ type: 'done' }]);
  });

  it('emits error and done on non-zero exit when stream never finished', () => {
    const chunks = [...emitCursorQueryCompletionChunks({
      canceled: false,
      sawDone: false,
      exitCode: 1,
      stderr: 'boom',
    })];
    expect(chunks).toEqual([
      { type: 'error', content: 'boom' },
      { type: 'done' },
    ]);
  });

  it('emits nothing extra when result event already arrived', () => {
    const chunks = [...emitCursorQueryCompletionChunks({
      canceled: false,
      sawDone: true,
      exitCode: 0,
      stderr: '',
    })];
    expect(chunks).toEqual([]);
  });
});
