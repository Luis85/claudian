// NDJSON lines for AskUserQuestion started → completed (skipped) on separate events.
export const SAMPLE_CURSOR_ASK_USER_QUESTION_STREAM_LINES: readonly string[] = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    model: 'composer-2.5',
    session_id: 'ask-fixture-session',
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'call-ask-1',
    session_id: 'ask-fixture-session',
    tool_call: {
      askQuestionToolCall: {
        args: {
          questions: [{
            question: 'Pick a focus',
            options: [{ label: 'Cursor parity' }, { label: 'Trust UX' }],
          }],
        },
      },
    },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'call-ask-1',
    session_id: 'ask-fixture-session',
    tool_call: {
      askQuestionToolCall: {
        args: {
          questions: [{
            question: 'Pick a focus',
            options: [{ label: 'Cursor parity' }, { label: 'Trust UX' }],
          }],
        },
        result: {
          success: {
            rejected: { reason: 'Questions skipped by user' },
          },
        },
      },
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    session_id: 'ask-fixture-session',
    is_error: false,
  }),
];
