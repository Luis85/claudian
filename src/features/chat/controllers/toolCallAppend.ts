import type { ChatMessage, ToolCallInfo } from '../../../core/types';

/** Minimal tool_use chunk shape needed to seed a running tool call. */
interface ToolUseSeed {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Builds a fresh, running (collapsed) tool call from a tool_use chunk. */
export function createRunningToolCall(chunk: ToolUseSeed): ToolCallInfo {
  return {
    id: chunk.id,
    name: chunk.name,
    input: chunk.input,
    status: 'running',
    isExpanded: false,
  };
}

/**
 * Appends a tool call to a message's tool list and records its order in
 * `contentBlocks`, lazily initializing both arrays.
 */
export function appendToolCallToMessage(msg: ChatMessage, toolCall: ToolCallInfo): void {
  msg.toolCalls = msg.toolCalls || [];
  msg.toolCalls.push(toolCall);
  msg.contentBlocks = msg.contentBlocks || [];
  msg.contentBlocks.push({ type: 'tool_use', toolId: toolCall.id });
}
