// src/features/tools/toolTypes.ts
import type { App } from 'obsidian';
import type { z } from 'zod';

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface SpecoratorToolManifest {
  name: string;                       // -> mcp__specorator__<name>
  description: string;
  input: z.ZodObject<z.ZodRawShape>;  // single schema -> validation + JSON schema
  // Reserved for a future result-validation pass; not yet consumed by the registry.
  output?: z.ZodTypeAny;
}

export interface ToolHostContext {
  app: App;
  signal: AbortSignal;
}

export interface SpecoratorToolModule {
  manifest: SpecoratorToolManifest;
  handler: (
    args: unknown,
    ctx: ToolHostContext,
  ) => Promise<ToolTextResult> | ToolTextResult;
}

export interface LoadedTool {
  id: string;                          // tool directory name
  module?: SpecoratorToolModule;
  jsonSchema?: Record<string, unknown>;
  error?: string;                      // transpile/eval/validation error, for the UI
}
