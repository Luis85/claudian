// src/features/tools/toolTypes.ts
import type { App } from 'obsidian';
import type { z } from 'zod';

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ClaudianToolManifest {
  name: string;                       // -> mcp__claudian__<name>
  description: string;
  input: z.ZodObject<z.ZodRawShape>;  // single schema -> validation + JSON schema
  output?: z.ZodTypeAny;
}

export interface ToolHostContext {
  app: App;
  signal: AbortSignal;
}

export interface ClaudianToolModule {
  manifest: ClaudianToolManifest;
  handler: (
    args: unknown,
    ctx: ToolHostContext,
  ) => Promise<ToolTextResult> | ToolTextResult;
}

export interface LoadedTool {
  id: string;                          // tool directory name
  module?: ClaudianToolModule;
  jsonSchema?: Record<string, unknown>;
  error?: string;                      // transpile/eval/validation error, for the UI
}
