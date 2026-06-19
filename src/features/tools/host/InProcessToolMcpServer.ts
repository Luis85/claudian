// src/features/tools/host/InProcessToolMcpServer.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { LoadedTool, ToolHostContext, ToolTextResult } from '../toolTypes';

export const CLAUDIAN_TOOL_SERVER_NAME = 'claudian';

export function buildClaudianToolMcpServer(
  loaded: LoadedTool[],
  ctxFactory: () => ToolHostContext,
): ReturnType<typeof createSdkMcpServer> {
  const tools = loaded
    .filter((t): t is LoadedTool & { module: NonNullable<LoadedTool['module']> } => !!t.module && !t.error)
    .map((t) =>
      tool(
        t.module.manifest.name,
        t.module.manifest.description,
        t.module.manifest.input.shape,
        async (args: unknown) => {
          const result: ToolTextResult = await t.module.handler(args, ctxFactory());
          return result as unknown as never;
        },
      ),
    );

  return createSdkMcpServer({
    name: CLAUDIAN_TOOL_SERVER_NAME,
    version: '1.0.0',
    tools,
  });
}
