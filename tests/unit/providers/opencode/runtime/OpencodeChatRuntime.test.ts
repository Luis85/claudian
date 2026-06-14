import { OpencodeChatRuntime } from '@/providers/opencode/runtime/OpencodeChatRuntime';

// The constructor only stores its (plugin, host) args, so a barebones runtime
// exercises the pure error-formatting seam without the ACP subprocess.
function makeRuntime(): Record<string, unknown> {
  const runtime = new OpencodeChatRuntime({} as never, {} as never);
  return runtime as unknown as Record<string, unknown>;
}

describe('OpencodeChatRuntime.formatRuntimeError', () => {
  type Format = (error: unknown) => string;

  it('uses the Error message when no stderr is captured', () => {
    const r = makeRuntime();
    expect((r.formatRuntimeError as Format).call(r, new Error('boom'))).toBe('boom');
  });

  it('falls back to a generic message for non-Error throwables', () => {
    const r = makeRuntime();
    expect((r.formatRuntimeError as Format).call(r, 'nope')).toBe('OpenCode request failed');
  });

  it('appends the process stderr snapshot when present', () => {
    const r = makeRuntime();
    r.process = { getStderrSnapshot: () => 'stderr tail' };
    expect((r.formatRuntimeError as Format).call(r, new Error('boom'))).toBe('boom\n\nstderr tail');
  });

  it('omits the stderr block when the snapshot is empty', () => {
    const r = makeRuntime();
    r.process = { getStderrSnapshot: () => '' };
    expect((r.formatRuntimeError as Format).call(r, new Error('boom'))).toBe('boom');
  });
});
