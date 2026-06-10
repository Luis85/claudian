import type { SDKMessage, SDKResultError } from '@anthropic-ai/claude-agent-sdk';

import { buildUsageInfo as sharedBuildUsageInfo } from '../../../core/providers/usage';
import type { SDKToolUseResult, StreamChunk, UsageInfo } from '../../../core/types';
import { isBlockedMessage } from '../sdk/messages';
import { extractToolResultContent } from '../sdk/toolResultContent';
import type { TransformEvent } from '../sdk/types';
import { getContextWindowSize } from '../types/models';
import { selectContextWindowEntry } from './contextWindowSelection';
import { createTransformStreamState, type TransformStreamState } from './toolInputStreamState';
import {
  createTransformUsageState,
  hasPromptUsageField,
  type MessageUsage,
  type PromptUsageSnapshot,
  toPromptUsageSnapshot,
  type TransformUsageState,
} from './transformUsageState';

type ToolUseFields = { id: string; name: string; input: Record<string, unknown> };
type ToolResultFields = { id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult };
type AsyncSubagentResultStatus = Extract<StreamChunk, { type: 'async_subagent_result' }>['status'];

type SystemMessage = Extract<SDKMessage, { type: 'system' }>;
type AssistantMessage = Extract<SDKMessage, { type: 'assistant' }>;
type UserMessage = Extract<SDKMessage, { type: 'user' }>;
type StreamEventMessage = Extract<SDKMessage, { type: 'stream_event' }>;
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;
type StreamEvent = StreamEventMessage['event'];

export { createTransformStreamState, createTransformUsageState };
export type { MessageUsage, TransformUsageState };

function getToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function emitToolUse(parentToolUseId: string | null, fields: ToolUseFields): StreamChunk {
  if (parentToolUseId === null) {
    return { type: 'tool_use', ...fields };
  }
  return { type: 'subagent_tool_use', subagentId: parentToolUseId, ...fields };
}

function emitToolResult(parentToolUseId: string | null, fields: ToolResultFields): StreamChunk {
  if (parentToolUseId === null) {
    return { type: 'tool_result', ...fields };
  }
  return { type: 'subagent_tool_result', subagentId: parentToolUseId, ...fields };
}

function normalizeTaskNotificationStatus(status: unknown): AsyncSubagentResultStatus {
  return status === 'completed' ? 'completed' : 'error';
}

function normalizeTaskNotificationResult(status: AsyncSubagentResultStatus, summary: unknown): string {
  if (typeof summary === 'string' && summary.trim().length > 0) {
    return summary.trim();
  }
  return status === 'completed' ? 'Background task completed.' : 'Background task failed.';
}

function transformTaskNotification(message: SDKMessage): StreamChunk | null {
  if (message.type !== 'system' || message.subtype !== 'task_notification') {
    return null;
  }

  const record = message as unknown as Record<string, unknown>;
  const taskId = record.task_id;
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return null;
  }

  const status = normalizeTaskNotificationStatus(record.status);
  return {
    type: 'async_subagent_result',
    agentId: taskId,
    status,
    result: normalizeTaskNotificationResult(status, record.summary),
  };
}

export interface TransformOptions {
  /** The intended model from settings/query (used for context window size). */
  intendedModel?: string;
  /** Custom context limits from settings (model ID → tokens). */
  customContextLimits?: Record<string, number>;
  /** Tracks active streamed tool blocks so input_json_delta can be normalized. */
  streamState?: TransformStreamState;
  /** Tracks prompt-token usage across Anthropic-compatible stream events. */
  usageState?: TransformUsageState;
}

function isResultError(message: { type: 'result'; subtype: string }): message is SDKResultError {
  return !!message.subtype && message.subtype !== 'success';
}

function buildUsageInfo(promptUsage: PromptUsageSnapshot, options?: TransformOptions): UsageInfo {
  // Fall back to the canonical short id used in `DEFAULT_CLAUDE_MODELS`
  // (`src/providers/claude/types/models.ts`) so the emitted UsageInfo.model
  // round-trips through downstream lookups (settings, pricing, tooltips).
  const model = options?.intendedModel?.trim() || 'sonnet';
  const contextWindow = getContextWindowSize(model, options?.customContextLimits);
  return sharedBuildUsageInfo({
    model,
    inputTokens: promptUsage.inputTokens,
    cacheCreationInputTokens: promptUsage.cacheCreationInputTokens,
    cacheReadInputTokens: promptUsage.cacheReadInputTokens,
    contextTokens: promptUsage.contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: options?.usageState?.isWindowAuthoritative() ?? false,
  });
}

function maybeEmitUsageFromPromptUsage(
  promptUsage: PromptUsageSnapshot,
  options?: TransformOptions,
  behavior: { emitZeroUsage?: boolean } = {},
): StreamChunk | null {
  if (promptUsage.contextTokens <= 0) {
    return behavior.emitZeroUsage
      ? { type: 'usage', usage: buildUsageInfo(promptUsage, options) }
      : null;
  }

  if (options?.usageState?.hasEmitted(promptUsage)) {
    return null;
  }

  options?.usageState?.markEmitted(promptUsage);
  return { type: 'usage', usage: buildUsageInfo(promptUsage, options) };
}

function* transformSystemMessage(message: SystemMessage): Generator<TransformEvent> {
  if (message.subtype === 'init' && message.session_id) {
    yield {
      type: 'session_init',
      sessionId: message.session_id,
      agents: message.agents,
      permissionMode: message.permissionMode,
    };
  } else if (message.subtype === 'compact_boundary') {
    yield { type: 'context_compacted' };
  } else if (message.subtype === 'task_notification') {
    const notification = transformTaskNotification(message);
    if (notification) {
      yield notification;
    }
  }
}

type AssistantContentBlock = AssistantMessage['message']['content'][number];

function emitAssistantToolUse(
  block: Extract<AssistantContentBlock, { type: 'tool_use' }>,
  parentToolUseId: string | null,
): StreamChunk {
  return emitToolUse(parentToolUseId, {
    id: block.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    name: block.name || 'unknown',
    input: getToolInput(block.input),
  });
}

function* transformAssistantContentBlock(
  block: AssistantContentBlock,
  parentToolUseId: string | null,
): Generator<TransformEvent> {
  if (block.type === 'thinking' && block.thinking) {
    if (parentToolUseId === null) {
      yield { type: 'thinking', content: block.thinking };
    }
  } else if (block.type === 'text' && block.text && block.text.trim() !== '(no content)') {
    if (parentToolUseId === null) {
      yield { type: 'text', content: block.text };
    }
  } else if (block.type === 'tool_use') {
    yield emitAssistantToolUse(block, parentToolUseId);
  }
}

function* emitAssistantUsage(usage: MessageUsage, options?: TransformOptions): Generator<TransformEvent> {
  if (options?.usageState) {
    const promptUsage = options.usageState.mergePromptUsage(usage);
    const usageChunk = maybeEmitUsageFromPromptUsage(promptUsage, options, { emitZeroUsage: true });
    if (usageChunk) {
      yield usageChunk;
    }
  } else {
    yield { type: 'usage', usage: buildUsageInfo(toPromptUsageSnapshot(usage), options) };
  }
}

function* transformAssistantContentBlocks(
  message: AssistantMessage,
  parentToolUseId: string | null,
): Generator<TransformEvent> {
  if (message.message?.content && Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      yield* transformAssistantContentBlock(block, parentToolUseId);
    }
  }
}

function* transformAssistantMessage(message: AssistantMessage, options?: TransformOptions): Generator<TransformEvent> {
  const parentToolUseId = message.parent_tool_use_id ?? null;

  // Errors on assistant messages (e.g. rate_limit, billing_error)
  if (message.error) {
    yield { type: 'error', content: message.error };
  }

  yield* transformAssistantContentBlocks(message, parentToolUseId);

  options?.streamState?.clearParent(parentToolUseId);

  // Extract usage from main agent assistant messages only (not subagent)
  // This gives accurate per-turn context usage without subagent token pollution
  const usage = (message.message as { usage?: MessageUsage } | undefined)?.usage;
  if (parentToolUseId === null && usage) {
    yield* emitAssistantUsage(usage, options);
  }
}

type UserContentBlock = Extract<UserMessage['message']['content'], readonly unknown[]>[number];

function emitUserToolResultBlock(
  block: Extract<UserContentBlock, { type: 'tool_result' }>,
  message: UserMessage,
  parentToolUseId: string | null,
): StreamChunk {
  const toolUseResult = (message.tool_use_result ?? undefined) as SDKToolUseResult | undefined;
  return emitToolResult(parentToolUseId, {
    id: block.tool_use_id || message.parent_tool_use_id || '',
    content: extractToolResultContent(block.content, { fallbackIndent: 2 }),
    isError: block.is_error || false,
    ...(toolUseResult !== undefined ? { toolUseResult } : {}),
  });
}

function* transformUserToolResultBlocks(
  message: UserMessage,
  parentToolUseId: string | null,
): Generator<TransformEvent> {
  if (!message.message?.content || !Array.isArray(message.message.content)) {
    return;
  }
  for (const block of message.message.content) {
    if (block.type === 'tool_result') {
      yield emitUserToolResultBlock(block, message, parentToolUseId);
    }
  }
}

function* transformUserMessage(message: UserMessage): Generator<TransformEvent> {
  const parentToolUseId = message.parent_tool_use_id ?? null;

  // Check for blocked tool calls (from hook denials)
  if (isBlockedMessage(message)) {
    yield {
      type: 'notice',
      content: message._blockReason,
      level: 'warning',
    };
    return;
  }
  // User messages can contain tool results
  if (message.tool_use_result !== undefined && message.parent_tool_use_id) {
    const toolUseResult = (message.tool_use_result ?? undefined) as SDKToolUseResult | undefined;
    yield emitToolResult(parentToolUseId, {
      id: message.parent_tool_use_id,
      content: extractToolResultContent(message.tool_use_result, { fallbackIndent: 2 }),
      isError: false,
      ...(toolUseResult !== undefined ? { toolUseResult } : {}),
    });
  }
  // Also check message.message.content for tool_result blocks
  yield* transformUserToolResultBlocks(message, parentToolUseId);
}

function* emitMessageStartUsage(
  event: Extract<StreamEvent, { type: 'message_start' }>,
  options?: TransformOptions,
): Generator<TransformEvent> {
  options?.usageState?.clear();
  const usage = (event.message as { usage?: MessageUsage } | undefined)?.usage;
  if (usage && hasPromptUsageField(usage)) {
    if (options?.usageState) {
      options.usageState.mergePromptUsage(usage);
    } else {
      const usageChunk = maybeEmitUsageFromPromptUsage(toPromptUsageSnapshot(usage), options);
      if (usageChunk) {
        yield usageChunk;
      }
    }
  }
}

function* emitMessageDeltaUsage(usage: MessageUsage, options?: TransformOptions): Generator<TransformEvent> {
  if (options?.usageState) {
    const previousPromptUsage = options.usageState.getPromptUsage();
    const promptUsage = options.usageState.mergePromptUsage(usage);
    const shouldEmitDeltaUsage = previousPromptUsage.contextTokens <= 0
      || options.usageState.hasEmitted(previousPromptUsage);
    if (shouldEmitDeltaUsage) {
      const usageChunk = maybeEmitUsageFromPromptUsage(promptUsage, options);
      if (usageChunk) {
        yield usageChunk;
      }
    }
  } else {
    const usageChunk = maybeEmitUsageFromPromptUsage(toPromptUsageSnapshot(usage), options);
    if (usageChunk) {
      yield usageChunk;
    }
  }
}

type ContentBlockStartEvent = Extract<StreamEvent, { type: 'content_block_start' }>;

function* emitStreamedToolUseStart(
  event: ContentBlockStartEvent,
  contentBlock: Extract<ContentBlockStartEvent['content_block'], { type: 'tool_use' }>,
  parentToolUseId: string | null,
  options?: TransformOptions,
): Generator<TransformEvent> {
  const toolUseFields: ToolUseFields = {
    id: contentBlock.id || `tool-${Date.now()}`,
    name: contentBlock.name || 'unknown',
    input: getToolInput(contentBlock.input),
  };
  if (typeof event.index === 'number') {
    options?.streamState?.registerToolUse(parentToolUseId, event.index, toolUseFields);
  }
  yield emitToolUse(parentToolUseId, toolUseFields);
}

function* emitContentBlockStartContent(
  contentBlock: ContentBlockStartEvent['content_block'],
  parentToolUseId: string | null,
): Generator<TransformEvent> {
  if (contentBlock?.type === 'thinking') {
    if (parentToolUseId === null && contentBlock.thinking) {
      yield { type: 'thinking', content: contentBlock.thinking };
    }
  } else if (contentBlock?.type === 'text') {
    if (parentToolUseId === null && contentBlock.text) {
      yield { type: 'text', content: contentBlock.text };
    }
  }
}

function* transformContentBlockStart(
  event: ContentBlockStartEvent,
  parentToolUseId: string | null,
  options?: TransformOptions,
): Generator<TransformEvent> {
  const contentBlock = event.content_block;
  if (contentBlock?.type === 'tool_use') {
    yield* emitStreamedToolUseStart(event, contentBlock, parentToolUseId, options);
  } else {
    yield* emitContentBlockStartContent(contentBlock, parentToolUseId);
  }
}

function* emitContentDelta(
  delta: Extract<StreamEvent, { type: 'content_block_delta' }>['delta'],
): Generator<TransformEvent> {
  if (delta?.type === 'thinking_delta' && delta.thinking) {
    yield { type: 'thinking', content: delta.thinking };
  } else if (delta?.type === 'text_delta' && delta.text) {
    yield { type: 'text', content: delta.text };
  }
}

function* transformContentBlockDelta(
  event: Extract<StreamEvent, { type: 'content_block_delta' }>,
  parentToolUseId: string | null,
  options?: TransformOptions,
): Generator<TransformEvent> {
  if (event.delta?.type === 'input_json_delta' && typeof event.index === 'number') {
    const toolUseFields = options?.streamState?.applyInputJsonDelta(
      parentToolUseId,
      event.index,
      event.delta.partial_json,
    );
    if (toolUseFields) {
      yield emitToolUse(parentToolUseId, toolUseFields);
    }
  } else if (parentToolUseId === null) {
    yield* emitContentDelta(event.delta);
  }
}

function* transformMessageUsageEvent(
  event: Extract<StreamEvent, { type: 'message_start' | 'message_delta' }>,
  options?: TransformOptions,
): Generator<TransformEvent> {
  if (event.type === 'message_start') {
    yield* emitMessageStartUsage(event, options);
  } else if (hasPromptUsageField(event.usage)) {
    yield* emitMessageDeltaUsage(event.usage, options);
  }
}

function* transformContentBlockEvent(
  event: StreamEvent,
  parentToolUseId: string | null,
  options?: TransformOptions,
): Generator<TransformEvent> {
  if (event?.type === 'content_block_start') {
    yield* transformContentBlockStart(event, parentToolUseId, options);
  } else if (event?.type === 'content_block_delta') {
    yield* transformContentBlockDelta(event, parentToolUseId, options);
  } else if (event?.type === 'content_block_stop' && typeof event.index === 'number') {
    options?.streamState?.clearContentBlock(parentToolUseId, event.index);
  }
}

function* transformStreamEventMessage(
  message: StreamEventMessage,
  options?: TransformOptions,
): Generator<TransformEvent> {
  const parentToolUseId = message.parent_tool_use_id ?? null;
  const event = message.event;
  if (parentToolUseId === null && (event?.type === 'message_start' || event?.type === 'message_delta')) {
    yield* transformMessageUsageEvent(event, options);
  } else {
    yield* transformContentBlockEvent(event, parentToolUseId, options);
  }
}

function detectAuthoritativeContextWindow(message: ResultMessage, options?: TransformOptions): number | null {
  if ('modelUsage' in message && message.modelUsage) {
    const modelUsage = message.modelUsage as Record<string, { contextWindow?: number }>;
    const selectedEntry = selectContextWindowEntry(modelUsage, options?.intendedModel);
    if (selectedEntry) {
      options?.usageState?.markWindowAuthoritative();
      return selectedEntry.contextWindow;
    }
  }
  return null;
}

function* flushPromptUsage(options?: TransformOptions): Generator<TransformEvent> {
  if (!options?.usageState) {
    return;
  }
  const usageChunk = maybeEmitUsageFromPromptUsage(options.usageState.getPromptUsage(), options);
  if (usageChunk) {
    yield usageChunk;
  }
  options.usageState.clear();
}

function* transformResultMessage(message: ResultMessage, options?: TransformOptions): Generator<TransformEvent> {
  options?.streamState?.clearAll();

  // Detect authoritative context window from result.modelUsage BEFORE emitting the final
  // usage chunk, so the emitted UsageInfo carries contextWindowIsAuthoritative=true.
  const authoritativeContextWindow = detectAuthoritativeContextWindow(message, options);

  yield* flushPromptUsage(options);
  if (isResultError(message)) {
    const content = message.errors.filter((e) => e.trim().length > 0).join('\n');
    yield {
      type: 'error',
      content: content || `Result error: ${message.subtype}`,
    };
  }

  // Usage is now extracted from assistant messages for accuracy (excludes subagent tokens)
  // Result message usage is aggregated across main + subagents, causing inaccurate spikes

  if (authoritativeContextWindow !== null) {
    yield { type: 'context_window', contextWindow: authoritativeContextWindow };
  }
}

/**
 * Transform SDK message to StreamChunk format.
 * One SDK message can yield multiple chunks (e.g., text + tool_use blocks).
 */
export function* transformSDKMessage(
  message: SDKMessage,
  options?: TransformOptions
): Generator<TransformEvent> {
  switch (message.type) {
    case 'system':
      yield* transformSystemMessage(message);
      break;
    case 'assistant':
      yield* transformAssistantMessage(message, options);
      break;
    case 'user':
      yield* transformUserMessage(message);
      break;
    case 'stream_event':
      yield* transformStreamEventMessage(message, options);
      break;
    case 'result':
      yield* transformResultMessage(message, options);
      break;
    default:
      break;
  }
}
