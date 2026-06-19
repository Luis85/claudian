// tests/unit/features/tools/host/InProcessToolMcpServer.test.ts
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: jest.fn((name: string) => ({ __tool: name })),
  createSdkMcpServer: jest.fn((cfg: unknown) => ({ __server: cfg })),
}));

import { createSdkMcpServer,tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { buildClaudianToolMcpServer } from '@/features/tools/host/InProcessToolMcpServer';
import type { LoadedTool } from '@/features/tools/toolTypes';

describe('buildClaudianToolMcpServer', () => {
  it('registers one SDK tool per error-free loaded tool', () => {
    const loaded: LoadedTool[] = [
      {
        id: 'echo',
        module: {
          manifest: { name: 'echo', description: 'd', input: z.object({ text: z.string() }) },
          handler: async (a) => ({ content: [{ type: 'text', text: String((a as { text: string }).text) }] }),
        },
        jsonSchema: {},
      },
      { id: 'broken', error: 'bad' },
    ];

    buildClaudianToolMcpServer(loaded, () => ({ app: {} as never, signal: new AbortController().signal }));

    expect(tool).toHaveBeenCalledTimes(1);
    expect((tool as jest.Mock).mock.calls[0][0]).toBe('echo');
    expect(createSdkMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'claudian' }),
    );
  });
});
