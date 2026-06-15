import { CursorTaskResultInterpreter } from '@/providers/cursor/runtime/CursorTaskResultInterpreter';

const interp = new CursorTaskResultInterpreter();

describe('CursorTaskResultInterpreter.hasAsyncLaunchMarker', () => {
  it('returns false for non-record payloads', () => {
    expect(interp.hasAsyncLaunchMarker(null)).toBe(false);
    expect(interp.hasAsyncLaunchMarker([])).toBe(false);
    expect(interp.hasAsyncLaunchMarker('x')).toBe(false);
  });

  it('treats explicit background/async flags as launch markers', () => {
    expect(interp.hasAsyncLaunchMarker({ isBackground: true })).toBe(true);
    expect(interp.hasAsyncLaunchMarker({ isAsync: true })).toBe(true);
  });

  it('is not a launch marker once conversation steps are present', () => {
    expect(interp.hasAsyncLaunchMarker({ agentId: 'a1', conversationSteps: [{}] })).toBe(false);
  });

  it('uses a non-empty agentId as the marker, else false', () => {
    expect(interp.hasAsyncLaunchMarker({ agentId: 'a1' })).toBe(true);
    expect(interp.hasAsyncLaunchMarker({ agentId: '' })).toBe(false);
    expect(interp.hasAsyncLaunchMarker({})).toBe(false);
  });
});

describe('CursorTaskResultInterpreter.extractAgentId', () => {
  it('reads agentId or agent_id, else null', () => {
    expect(interp.extractAgentId({ agentId: 'a1' })).toBe('a1');
    expect(interp.extractAgentId({ agent_id: 'a2' })).toBe('a2');
    expect(interp.extractAgentId({ agentId: '' })).toBeNull();
    expect(interp.extractAgentId({})).toBeNull();
    expect(interp.extractAgentId(null)).toBeNull();
  });
});

describe('CursorTaskResultInterpreter.extractStructuredResult', () => {
  it('returns null for non-record payloads', () => {
    expect(interp.extractStructuredResult(null)).toBeNull();
  });

  it('falls back to result/output text when there are no conversation steps', () => {
    expect(interp.extractStructuredResult({ result: 'done' })).toBe('done');
    expect(interp.extractStructuredResult({ output: 'out' })).toBe('out');
    expect(interp.extractStructuredResult({})).toBeNull();
  });
});

describe('CursorTaskResultInterpreter.resolveTerminalStatus', () => {
  it('keeps the fallback unless the payload signals an error', () => {
    expect(interp.resolveTerminalStatus(null, 'completed')).toBe('completed');
    expect(interp.resolveTerminalStatus({}, 'completed')).toBe('completed');
    expect(interp.resolveTerminalStatus({ isError: true }, 'completed')).toBe('error');
    expect(interp.resolveTerminalStatus({ error: 'boom' }, 'completed')).toBe('error');
  });
});

describe('CursorTaskResultInterpreter misc', () => {
  it('has no tag values and no nested tool calls for a bare payload', () => {
    expect(interp.extractTagValue()).toBeNull();
    expect(interp.extractNestedToolCalls({}, 'parent-1')).toEqual([]);
  });
});
