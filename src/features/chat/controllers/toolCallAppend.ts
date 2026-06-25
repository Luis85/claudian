import type { App } from 'obsidian';

import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import { decorateToolSummaryPath, getToolName, getToolSummary } from '../rendering/ToolCallRenderer';

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

/**
 * Refreshes the header name + summary of an already-rendered tool block when a
 * later streaming chunk completes its input. Handles both the generic tool
 * layout (`.specorator-tool-*`) and the write/edit layout (`.specorator-write-edit-*`).
 * Pure DOM work — no state mutation — so it stays out of the streaming handler.
 */
export function updateRenderedToolCallHeader(
  app: App,
  toolEl: HTMLElement,
  name: string,
  input: Record<string, unknown>,
): void {
  const nameEl = toolEl.querySelector('.specorator-tool-name')
    ?? toolEl.querySelector('.specorator-write-edit-name');
  if (nameEl) {
    nameEl.setText(getToolName(name, input));
  }
  const summaryEl = toolEl.querySelector('.specorator-tool-summary')
    ?? toolEl.querySelector('.specorator-write-edit-summary');
  if (summaryEl) {
    summaryEl.setText(getToolSummary(name, input));
    decorateToolSummaryPath(app, summaryEl as HTMLElement, name, input);
  }
}
