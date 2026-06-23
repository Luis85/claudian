// src/features/tools/host/toolInvocation.ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { requestSignal } from '../toolRequestSignal';
import type { SpecoratorToolModule, ToolHostContext, ToolTextResult } from '../toolTypes';

// User tools run as trusted in-process code with full host privileges, so a
// buggy or runaway handler can hang a turn or flood the provider's context with
// unbounded output. These two guard rails bound both failure modes without
// changing the (deliberate) trust model: a wall-clock ceiling that aborts the
// per-request signal, and a character cap on the returned text.
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const DEFAULT_TOOL_MAX_RESULT_CHARS = 1_000_000;

export interface BoundedToolConfig {
  timeoutMs?: number;
  maxResultChars?: number;
}

class ToolTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Tool handler exceeded ${timeoutMs}ms and was aborted.`);
    this.name = 'ToolTimeoutError';
  }
}

/** Caps total returned text so a runaway handler can't flood provider context. */
function boundResult(result: ToolTextResult, maxChars: number): ToolTextResult {
  let remaining = maxChars;
  let truncated = false;
  const content: ToolTextResult['content'] = [];
  for (const block of result.content) {
    if (remaining <= 0) { truncated = true; break; }
    if (block.text.length <= remaining) {
      content.push(block);
      remaining -= block.text.length;
    } else {
      content.push({ type: 'text', text: block.text.slice(0, remaining) });
      remaining = 0;
      truncated = true;
    }
  }
  if (!truncated) return result;
  content.push({ type: 'text', text: `\n[specorator: tool output truncated at ${maxChars} characters]` });
  return { ...result, content };
}

/**
 * Runs a user-tool handler with a wall-clock timeout and bounded result text.
 * On timeout the per-request signal is aborted (so a cooperative handler can
 * stop work) and a graceful `isError` result is returned rather than throwing a
 * transport-level error. Genuine handler rejections propagate unchanged so the
 * MCP host reports them as before. Shared by both tool hosts (SDK + HTTP).
 */
export async function invokeBoundedToolHandler(
  handler: SpecoratorToolModule['handler'],
  args: unknown,
  ctxFactory: (signal: AbortSignal) => ToolHostContext,
  hostSignal: AbortSignal,
  config: BoundedToolConfig = {},
): Promise<ToolTextResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const maxResultChars = config.maxResultChars ?? DEFAULT_TOOL_MAX_RESULT_CHARS;

  const controller = new AbortController();
  const onHostAbort = (): void => controller.abort();
  if (hostSignal.aborted) controller.abort();
  else hostSignal.addEventListener('abort', onHostAbort, { once: true });

  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      controller.abort();
      reject(new ToolTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      Promise.resolve(handler(args, ctxFactory(controller.signal))),
      timeout,
    ]);
    return boundResult(result, maxResultChars);
  } catch (err) {
    if (err instanceof ToolTimeoutError) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
    throw err;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    hostSignal.removeEventListener('abort', onHostAbort);
  }
}

/**
 * The MCP call callback shared by both tool hosts (SDK `tool()` and HTTP
 * `registerTool()`): extracts the per-request signal, runs the handler under the
 * timeout/result bounds, and reconciles the narrower text-only `ToolTextResult`
 * to the SDK's wider `CallToolResult` union (which also allows image/audio).
 */
export function makeBoundedToolCallback(
  module: SpecoratorToolModule,
  ctxFactory: (signal: AbortSignal) => ToolHostContext,
): (args: unknown, extra: unknown) => Promise<CallToolResult> {
  return async (args, extra) => {
    const result = await invokeBoundedToolHandler(module.handler, args, ctxFactory, requestSignal(extra));
    return result as unknown as CallToolResult;
  };
}
