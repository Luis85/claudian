/**
 * @jest-environment jsdom
 */
// tests/unit/features/tools/host/toolInvocation.test.ts
import {
  DEFAULT_TOOL_MAX_RESULT_CHARS,
  invokeBoundedToolHandler,
} from '@/features/tools/host/toolInvocation';
import type { ToolHostContext, ToolTextResult } from '@/features/tools/toolTypes';

const ctxFactory = (signal: AbortSignal): ToolHostContext =>
  ({ app: {} as ToolHostContext['app'], signal });

function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

describe('invokeBoundedToolHandler', () => {
  it('returns the handler result unchanged when within bounds', async () => {
    const handler = async (): Promise<ToolTextResult> => ({ content: [{ type: 'text', text: 'hi' }] });
    const result = await invokeBoundedToolHandler(handler, {}, ctxFactory, neverAborted());
    expect(result.content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('returns a graceful error result and aborts the signal on timeout', async () => {
    let observed: AbortSignal | undefined;
    const handler = (_args: unknown, ctx: ToolHostContext): Promise<ToolTextResult> => {
      observed = ctx.signal;
      return new Promise(() => {}); // never resolves
    };

    const result = await invokeBoundedToolHandler(
      handler, {}, ctxFactory, neverAborted(), { timeoutMs: 5 },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/exceeded 5ms/);
    expect(observed?.aborted).toBe(true);
  });

  it('truncates oversized output and appends a notice', async () => {
    const big = 'x'.repeat(DEFAULT_TOOL_MAX_RESULT_CHARS + 100);
    const handler = async (): Promise<ToolTextResult> => ({ content: [{ type: 'text', text: big }] });

    const result = await invokeBoundedToolHandler(handler, {}, ctxFactory, neverAborted());

    expect(result.content[0].text).toHaveLength(DEFAULT_TOOL_MAX_RESULT_CHARS);
    expect(result.content[result.content.length - 1].text).toMatch(/truncated/);
  });

  it('aborts the handler signal when the host signal aborts', async () => {
    const host = new AbortController();
    let observed: AbortSignal | undefined;
    const handler = (_args: unknown, ctx: ToolHostContext): Promise<ToolTextResult> => {
      observed = ctx.signal;
      return new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () =>
          resolve({ content: [{ type: 'text', text: 'stopped' }] }),
        );
      });
    };

    const pending = invokeBoundedToolHandler(handler, {}, ctxFactory, host.signal, { timeoutMs: 10_000 });
    host.abort();
    const result = await pending;

    expect(observed?.aborted).toBe(true);
    expect(result.content[0].text).toBe('stopped');
  });

  it('propagates a genuine handler rejection unchanged', async () => {
    const handler = async (): Promise<ToolTextResult> => { throw new Error('boom'); };
    await expect(
      invokeBoundedToolHandler(handler, {}, ctxFactory, neverAborted()),
    ).rejects.toThrow('boom');
  });
});
