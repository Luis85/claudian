// src/features/tools/host/InProcessToolMcpServer.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

import type { LoadedTool, ToolHostContext } from '../toolTypes';
import { makeBoundedToolCallback } from './toolInvocation';

export const SPECORATOR_TOOL_SERVER_NAME = 'specorator';

export function buildSpecoratorToolMcpServer(
  loaded: LoadedTool[],
  ctxFactory: (signal: AbortSignal) => ToolHostContext,
): ReturnType<typeof createSdkMcpServer> {
  const tools = loaded
    .filter((t): t is LoadedTool & { module: NonNullable<LoadedTool['module']> } => !!t.module && !t.error)
    .map((t) =>
      tool(
        t.module.manifest.name,
        t.module.manifest.description,
        t.module.manifest.input.shape,
        makeBoundedToolCallback(t.module, ctxFactory),
      ),
    );

  return createSdkMcpServer({
    name: SPECORATOR_TOOL_SERVER_NAME,
    version: '1.0.0',
    tools,
  });
}
