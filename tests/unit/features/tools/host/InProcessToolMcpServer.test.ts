// tests/unit/features/tools/host/InProcessToolMcpServer.test.ts
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: jest.fn((name: string) => ({ __tool: name })),
  createSdkMcpServer: jest.fn((cfg: unknown) => ({ __server: cfg })),
}));

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { buildSpecoratorToolMcpServer } from '@/features/tools/host/InProcessToolMcpServer';
import type { SpecoratorToolModule, LoadedTool, ToolHostContext } from '@/features/tools/toolTypes';

beforeEach(() => {
  jest.clearAllMocks();
});

function echoTool(handler: SpecoratorToolModule['handler'] = async (a) => ({
  content: [{ type: 'text', text: String((a as { text: string }).text) }],
})): LoadedTool {
  return {
    id: 'echo',
    module: {
      manifest: { name: 'echo', description: 'd', input: z.object({ text: z.string() }) },
      handler,
    },
    jsonSchema: {},
  };
}

describe('buildSpecoratorToolMcpServer', () => {
  it('registers one SDK tool per error-free loaded tool', () => {
    const loaded: LoadedTool[] = [echoTool(), { id: 'broken', error: 'bad' }];

    buildSpecoratorToolMcpServer(loaded, () => ({ app: {} as never, signal: new AbortController().signal }));

    expect(tool).toHaveBeenCalledTimes(1);
    expect((tool as jest.Mock).mock.calls[0][0]).toBe('echo');
    expect(createSdkMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'specorator' }),
    );
  });

  it('wires the registered handler to the module handler with the host context', async () => {
    const handler = jest.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const ctx: ToolHostContext = { app: {} as never, signal: new AbortController().signal };

    buildSpecoratorToolMcpServer([echoTool(handler)], () => ctx);

    // The 4th arg to tool() is the SDK-facing handler the server invokes.
    const sdkHandler = (tool as jest.Mock).mock.calls[0][3] as (args: unknown) => Promise<unknown>;
    const result = await sdkHandler({ text: 'hi' });

    expect(handler).toHaveBeenCalledWith({ text: 'hi' }, ctx);
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });
});
