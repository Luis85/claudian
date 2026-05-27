import { noAsyncTaskInterpreter } from '@/core/providers/noAsyncTaskInterpreter';

describe('noAsyncTaskInterpreter', () => {
  it('never reports an async launch marker', () => {
    expect(noAsyncTaskInterpreter.hasAsyncLaunchMarker({ any: 'shape' })).toBe(false);
  });

  it('extracts no agent id', () => {
    expect(noAsyncTaskInterpreter.extractAgentId({ any: 'shape' })).toBeNull();
  });

  it('extracts no structured result', () => {
    expect(noAsyncTaskInterpreter.extractStructuredResult({ any: 'shape' })).toBeNull();
  });

  it('passes the fallback terminal status through unchanged', () => {
    expect(noAsyncTaskInterpreter.resolveTerminalStatus({}, 'completed')).toBe('completed');
    expect(noAsyncTaskInterpreter.resolveTerminalStatus({}, 'error')).toBe('error');
  });

  it('extracts no tag value', () => {
    expect(noAsyncTaskInterpreter.extractTagValue('<result>x</result>', 'result')).toBeNull();
  });
});
