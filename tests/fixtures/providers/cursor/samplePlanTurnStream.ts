// Minimal NDJSON for a plan-mode turn that completes CreatePlan.
export const SAMPLE_CURSOR_PLAN_TURN_STREAM_LINES: readonly string[] = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: 'plan-fixture-session',
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'call-plan-1',
    session_id: 'plan-fixture-session',
    tool_call: { createPlanToolCall: { args: { title: 'Test plan' } } },
  }),
  JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'call-plan-1',
    session_id: 'plan-fixture-session',
    tool_call: {
      createPlanToolCall: {
        args: { title: 'Test plan' },
        result: { success: { message: 'Plan created' } },
      },
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    session_id: 'plan-fixture-session',
    is_error: false,
  }),
];
