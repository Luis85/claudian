import { requestSignal } from '@/features/tools/toolRequestSignal';

describe('requestSignal', () => {
  it('returns the MCP request signal when extra carries one', () => {
    const controller = new AbortController();
    const signal = requestSignal({ signal: controller.signal });
    expect(signal).toBe(controller.signal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('falls back to a fresh never-aborted signal when extra has no signal', () => {
    expect(requestSignal(undefined).aborted).toBe(false);
    expect(requestSignal({}).aborted).toBe(false);
    expect(requestSignal({ signal: 'not-a-signal' }).aborted).toBe(false);
  });
});
