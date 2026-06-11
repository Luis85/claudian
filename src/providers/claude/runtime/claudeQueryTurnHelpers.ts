/**
 * Pure helpers for ClaudeChatRuntime's live turn flow: promise-based streaming
 * handler state for the persistent-query path, per-turn allowed-tool
 * resolution, turn-invocation normalization, stream-content bookkeeping, and
 * history-rebuild prompt construction for session recovery.
 */

import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type {
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
  PreparedChatTurn,
} from '../../../core/runtime/types';
import { TOOL_SKILL } from '../../../core/tools/toolNames';
import type { ChatMessage, ImageAttachment, StreamChunk } from '../../../core/types';
import { stripCurrentNoteContext } from '../../../utils/context';
import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
  getLastUserMessage,
} from '../../../utils/session';
import type { TransformEvent } from '../sdk/types';
import type { MessageChannel } from './ClaudeMessageChannel';
import { createResponseHandler, type ResponseHandler } from './types';

interface StreamingTurnState {
  chunks: StreamChunk[];
  resolveChunk: ((chunk: StreamChunk | null) => void) | null;
  done: boolean;
  error: Error | null;
}

/**
 * Creates the promise-based handler used to bridge consumer-loop callbacks
 * into an async generator. Uses a mutable state object to work around
 * TypeScript's control flow analysis.
 */
export function createStreamingTurnHandler(): {
  state: StreamingTurnState;
  handler: ResponseHandler;
  handlerId: string;
} {
  const state: StreamingTurnState = {
    chunks: [],
    resolveChunk: null,
    done: false,
    error: null,
  };

  const handlerId = `handler-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const handler = createResponseHandler({
    id: handlerId,
    onChunk: (chunk) => {
      handler.markChunkSeen();
      if (state.resolveChunk) {
        state.resolveChunk(chunk);
        state.resolveChunk = null;
      } else {
        state.chunks.push(chunk);
      }
    },
    onDone: () => {
      state.done = true;
      if (state.resolveChunk) {
        state.resolveChunk(null);
        state.resolveChunk = null;
      }
    },
    onError: (err) => {
      state.error = err;
      state.done = true;
      if (state.resolveChunk) {
        state.resolveChunk(null);
        state.resolveChunk = null;
      }
    },
  });

  return { state, handler, handlerId };
}

export async function* drainStreamingTurn(state: StreamingTurnState): AsyncGenerator<StreamChunk> {
  // Yield chunks as they arrive
  while (!state.done) {
    if (state.chunks.length > 0) {
      yield state.chunks.shift()!;
    } else {
      const chunk = await new Promise<StreamChunk | null>((resolve) => {
        state.resolveChunk = resolve;
      });
      if (chunk) {
        yield chunk;
      }
    }
  }

  // Yield any remaining chunks
  while (state.chunks.length > 0) {
    yield state.chunks.shift()!;
  }
}

/**
 * Allowed tools for canUseTool enforcement on the persistent path.
 * undefined = no restriction (null), [] = no tools, [...] = restricted
 * (Skill stays available alongside the restriction).
 */
export function resolveTurnAllowedTools(allowedTools: string[] | undefined): string[] | null {
  if (allowedTools === undefined) {
    return null;
  }
  return allowedTools.length > 0 ? [...allowedTools, TOOL_SKILL] : [];
}

/** Cold-start variant: undefined means "no restriction" in SDK options. */
export function resolveColdStartAllowedTools(allowedTools: string[] | undefined): string[] | undefined {
  if (allowedTools === undefined || allowedTools.length === 0) {
    return undefined;
  }
  return [...new Set([...allowedTools, TOOL_SKILL])];
}

/** Builds the prompt that injects prior conversation history (context rebuild). */
export function buildHistoryContextPrompt(prompt: string, conversationHistory: ChatMessage[]): string {
  const historyContext = buildContextFromHistory(conversationHistory);
  const actualPrompt = stripCurrentNoteContext(prompt);
  return buildPromptWithHistoryContext(historyContext, prompt, actualPrompt, conversationHistory);
}

export function buildHistoryRebuildRequest(
  prompt: string,
  conversationHistory: ChatMessage[],
): { prompt: string; images?: ImageAttachment[] } {
  const fullPrompt = buildHistoryContextPrompt(prompt, conversationHistory);
  const lastUserMessage = getLastUserMessage(conversationHistory);

  return {
    prompt: fullPrompt,
    images: lastUserMessage?.images,
  };
}

export function isChatMessageArray(value: unknown): value is ChatMessage[] {
  return Array.isArray(value) && value.length > 0 &&
    !!value[0] && typeof value[0] === 'object' && 'role' in value[0] && 'content' in value[0];
}

export function isImageAttachmentArray(value: unknown): value is ImageAttachment[] {
  return Array.isArray(value) && value.length > 0 &&
    !!value[0] && typeof value[0] === 'object' && 'mediaType' in value[0] && 'data' in value[0];
}

// Catalog rows override legacy map entries so user-edited customModels[].contextWindow
// values flow into the usage transform without restructuring the deeper pipeline.
export function mergeCustomModelContextLimits(
  legacyLimits: Record<string, number> | undefined,
  customModels: ReadonlyArray<{ id: string; contextWindow?: number }>,
): Record<string, number> {
  const merged: Record<string, number> = { ...(legacyLimits ?? {}) };
  for (const row of customModels) {
    if (row.contextWindow !== undefined) {
      merged[row.id] = row.contextWindow;
    }
  }
  return merged;
}

export function buildLegacyTurnRequest(
  prompt: string,
  images?: ImageAttachment[],
  queryOptions?: ChatRuntimeQueryOptions,
): ChatTurnRequest {
  return {
    text: prompt,
    images,
    externalContextPaths: queryOptions?.externalContextPaths,
    enabledMcpServers: queryOptions?.enabledMcpServers,
  };
}

export function buildQueryOptionsFromTurnRequest(
  request: ChatTurnRequest,
  encodedTurn: PreparedChatTurn,
  legacyQueryOptions?: ChatRuntimeQueryOptions,
): ChatRuntimeQueryOptions | undefined {
  const mcpMentions = legacyQueryOptions?.mcpMentions
    ? new Set([...legacyQueryOptions.mcpMentions, ...encodedTurn.mcpMentions])
    : encodedTurn.mcpMentions;

  const effectiveQueryOptions: ChatRuntimeQueryOptions = {
    allowedTools: legacyQueryOptions?.allowedTools,
    model: legacyQueryOptions?.model,
    mcpMentions,
    enabledMcpServers: request.enabledMcpServers ?? legacyQueryOptions?.enabledMcpServers,
    forceColdStart: legacyQueryOptions?.forceColdStart,
    externalContextPaths: request.externalContextPaths ?? legacyQueryOptions?.externalContextPaths,
  };

  if (
    effectiveQueryOptions.allowedTools === undefined &&
    effectiveQueryOptions.model === undefined &&
    effectiveQueryOptions.enabledMcpServers === undefined &&
    effectiveQueryOptions.forceColdStart === undefined &&
    effectiveQueryOptions.externalContextPaths === undefined &&
    (effectiveQueryOptions.mcpMentions?.size ?? 0) === 0
  ) {
    return undefined;
  }

  return effectiveQueryOptions;
}

export function noteVisibleStreamContent(
  message: SDKMessage,
  event: TransformEvent,
  callbacks: { onText: () => void; onThinking: () => void },
): void {
  // Drive dedup off transformed chunks rather than raw SDK message shapes.
  // transformSDKMessage already filters out empty payloads and subagent-only
  // stream events, so these callbacks only fire for content the user can see.
  if (message.type !== 'stream_event') {
    return;
  }

  if (event.type === 'text') {
    callbacks.onText();
  } else if (event.type === 'thinking') {
    callbacks.onThinking();
  }
}

/** Returns false when the channel closed underneath us (caller falls back to cold-start). */
export function tryEnqueueTurnMessage(channel: MessageChannel, message: SDKUserMessage): boolean {
  try {
    channel.enqueue(message);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('closed')) {
      return false;
    }
    throw error;
  }
}
