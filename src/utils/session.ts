/**
 * Claudian - Session Utilities
 *
 * Session recovery and history reconstruction.
 */

import type { ChatMessage, ToolCallInfo } from '../core/types';
import { extractUserQuery, formatCurrentNote } from './context';

// ============================================
// Session Recovery
// ============================================

const SESSION_ERROR_PATTERNS = [
  'session expired',
  'session not found',
  'invalid session',
  'session invalid',
  'process exited with code',
] as const;

const SESSION_ERROR_COMPOUND_PATTERNS = [
  { includes: ['session', 'expired'] },
  { includes: ['resume', 'failed'] },
  { includes: ['resume', 'error'] },
] as const;

export function isSessionExpiredError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : '';

  for (const pattern of SESSION_ERROR_PATTERNS) {
    if (msg.includes(pattern)) {
      return true;
    }
  }

  for (const { includes } of SESSION_ERROR_COMPOUND_PATTERNS) {
    if (includes.every(part => msg.includes(part))) {
      return true;
    }
  }

  return false;
}

// ============================================
// History Reconstruction
// ============================================

/**
 * Renders a single non-null tool-input value to its display string. Flattening the
 * `typeof` dispatch out of the entry loop keeps both this and the loop shallow.
 */
function formatToolInputValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 100 ? `${value.slice(0, 100)}...` : value;
  }
  if (typeof value === 'object') {
    return '[object]';
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (typeof value === 'symbol') {
    return value.description ? `[symbol:${value.description}]` : '[symbol]';
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  return '[unknown]';
}

/**
 * Formats tool input for inclusion in rebuilt context.
 * Includes all non-null parameters, truncates long string values.
 */
function formatToolInput(input: Record<string, unknown>, maxLength = 200): string {
  if (!input || Object.keys(input).length === 0) return '';

  try {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue;
      parts.push(`${key}=${formatToolInputValue(value)}`);
    }

    const result = parts.join(', ');
    return result.length > maxLength ? `${result.slice(0, maxLength)}...` : result;
  } catch {
    return '[input formatting error]';
  }
}

/**
 * Formats a tool call for inclusion in rebuilt context.
 *
 * Strategy:
 * - Always include tool name and input (so Claude knows what was attempted)
 * - Only include results for failed tools (errors are important to remember)
 * - Successful tools can be re-executed if needed
 */
export function formatToolCallForContext(toolCall: ToolCallInfo, maxErrorLength = 500): string {
  const status = toolCall.status ?? 'completed';
  const isFailed = status === 'error' || status === 'blocked';
  const inputStr = formatToolInput(toolCall.input);
  const inputPart = inputStr ? ` input: ${inputStr}` : '';

  if (!isFailed) {
    return `[Tool ${toolCall.name}${inputPart} status=${status}]`;
  }

  const hasResult = typeof toolCall.result === 'string' && toolCall.result.trim().length > 0;
  if (!hasResult) {
    return `[Tool ${toolCall.name}${inputPart} status=${status}]`;
  }

  const errorMsg = truncateToolResult(toolCall.result as string, maxErrorLength);
  return `[Tool ${toolCall.name}${inputPart} status=${status}] error: ${errorMsg}`;
}

export function truncateToolResult(result: string, maxLength = 500): string {
  if (result.length > maxLength) {
    return `${result.slice(0, maxLength)}... (truncated)`;
  }
  return result;
}

export function formatContextLine(message: ChatMessage): string | null {
  if (!message.currentNote) {
    return null;
  }
  return formatCurrentNote(message.currentNote);
}

/**
 * Formats thinking blocks for inclusion in rebuilt context.
 * Just indicates that thinking occurred (content not included - Claude will think anew).
 */
function formatThinkingBlocks(message: ChatMessage): string[] {
  if (!message.contentBlocks) return [];

  const thinkingBlocks = message.contentBlocks.filter(
    (block): block is { type: 'thinking'; content: string; durationSeconds?: number } =>
      block.type === 'thinking'
  );

  if (thinkingBlocks.length === 0) return [];

  const totalDuration = thinkingBlocks.reduce(
    (sum, block) => sum + (block.durationSeconds ?? 0),
    0
  );

  const durationPart = totalDuration > 0 ? `, ${totalDuration.toFixed(1)}s total` : '';
  return [`[Thinking: ${thinkingBlocks.length} block(s)${durationPart}]`];
}

/**
 * Decides whether a message contributes nothing to the rebuilt context and
 * should be dropped. Non-user/assistant roles, interrupts, and empty assistant
 * turns (no content, tool calls, or thinking) carry no signal.
 */
function shouldSkipHistoryMessage(message: ChatMessage): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return true;
  }

  if (message.isInterrupt) {
    return true;
  }

  if (message.role === 'assistant') {
    const hasContent = message.content && message.content.trim().length > 0;
    const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
    const hasThinking = message.contentBlocks?.some(b => b.type === 'thinking');
    if (!hasContent && !hasToolCalls && !hasThinking) {
      return true;
    }
  }

  return false;
}

/**
 * Builds the leading `Role: ...` line, prepending the current-note context
 * (when present) above the message content.
 */
function formatHistoryRoleLine(message: ChatMessage): string {
  const role = message.role === 'user' ? 'User' : 'Assistant';
  const content = message.content?.trim();
  const contextLine = formatContextLine(message);

  const userPayload = contextLine
    ? content
      ? `${contextLine}\n\n${content}`
      : contextLine
    : content;

  return userPayload ? `${role}: ${userPayload}` : `${role}:`;
}

/**
 * Collects the assistant-only follow-up lines (thinking summary + tool calls)
 * that trail the role line. Returns an empty array for user messages.
 */
function formatAssistantExtraLines(message: ChatMessage): string[] {
  if (message.role !== 'assistant') return [];

  const lines: string[] = [...formatThinkingBlocks(message)];

  if (message.toolCalls?.length) {
    const toolLines = message.toolCalls
      .map(tc => formatToolCallForContext(tc))
      .filter(Boolean);
    lines.push(...toolLines);
  }

  return lines;
}

export function buildContextFromHistory(messages: ChatMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (shouldSkipHistoryMessage(message)) {
      continue;
    }

    const lines = [formatHistoryRoleLine(message), ...formatAssistantExtraLines(message)];
    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
}

export function getLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i];
    }
  }
  return undefined;
}

/**
 * Builds a prompt with history context for session recovery.
 * Avoids duplicating the current prompt if it's already the last user message.
 */
export function buildPromptWithHistoryContext(
  historyContext: string | null,
  prompt: string,
  actualPrompt: string,
  conversationHistory: ChatMessage[]
): string {
  if (!historyContext) return prompt;

  const lastUserMessage = getLastUserMessage(conversationHistory);

  // Compare actual user queries, not XML-wrapped versions
  const lastUserQuery = lastUserMessage?.displayContent
    ?? extractUserQuery(lastUserMessage?.content ?? '');
  const currentUserQuery = extractUserQuery(actualPrompt);

  const shouldAppendPrompt = !lastUserMessage ||
    lastUserQuery.trim() !== currentUserQuery.trim();

  return shouldAppendPrompt
    ? `${historyContext}\n\nUser: ${prompt}`
    : historyContext;
}
