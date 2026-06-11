import type { ToolCallInfo } from '../../../core/types';
import {
  normalizeCodexToolInput,
  normalizeCodexToolName,
  normalizeCodexToolResult,
} from '../normalization/codexToolNormalization';
import type { PersistedParseContext, TurnAccumulator } from './codexTurnState';
import {
  ensureAssistantBubble,
  ensureTurn,
  findPersistedToolCallById,
  nextTurnId,
  pushToolInvocation,
  replaceLatestChunk,
  setTextBlock,
  setThinkingBlock,
} from './codexTurnState';

export interface CodexItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  changes?: Array<{ path: string; kind: string }>;
  query?: string;
  message?: string;
  server?: string;
  tool?: string;
}

// ---------------------------------------------------------------------------
// Tool-call seeds shared by the pure-legacy and mixed-session paths
// ---------------------------------------------------------------------------

function commandExecutionSeed(item: CodexItem): ToolCallInfo {
  return {
    id: item.id,
    name: normalizeCodexToolName(item.type),
    input: normalizeCodexToolInput(item.type, { command: item.command ?? '' }),
    status: 'running',
  };
}

function webSearchSeed(item: CodexItem): ToolCallInfo {
  return {
    id: item.id,
    name: normalizeCodexToolName(item.type),
    input: normalizeCodexToolInput(item.type, { query: item.query ?? '' }),
    status: 'running',
  };
}

function mcpToolCallSeed(item: CodexItem): ToolCallInfo {
  return {
    id: item.id,
    name: `mcp__${item.server ?? ''}__${item.tool ?? ''}`,
    input: {},
    status: 'running',
  };
}

// ---------------------------------------------------------------------------
// Legacy event wrapper processing (flat TurnAccumulator)
// ---------------------------------------------------------------------------

export function processLegacyItem(
  eventType: string,
  item: CodexItem,
  turn: TurnAccumulator,
): void {
  switch (item.type) {
    case 'agent_message':
      applyLegacyAgentMessage(eventType, item, turn);
      break;
    case 'reasoning':
      applyLegacyReasoning(eventType, item, turn);
      break;
    case 'command_execution':
      applyLegacyCommandExecution(eventType, item, turn);
      break;
    case 'file_change':
      applyLegacyFileChange(eventType, item, turn);
      break;
    case 'web_search':
      applyLegacyWebSearch(eventType, item, turn);
      break;
    case 'mcp_tool_call':
      applyLegacyMcpToolCall(eventType, item, turn);
      break;
    default:
      break;
  }
}

function isLegacyTextEvent(eventType: string): boolean {
  return eventType === 'item.completed' || eventType === 'item.updated';
}

function applyLegacyAgentMessage(eventType: string, item: CodexItem, turn: TurnAccumulator): void {
  if (isLegacyTextEvent(eventType) && item.text) {
    turn.assistantText = item.text;
    setTextBlock(turn, item.text);
  }
}

function applyLegacyReasoning(eventType: string, item: CodexItem, turn: TurnAccumulator): void {
  if (isLegacyTextEvent(eventType) && item.text) {
    setThinkingBlock(turn, item.text);
  }
}

function pushLegacyToolCall(turn: TurnAccumulator, toolCall: ToolCallInfo): void {
  turn.toolCalls.push(toolCall);
  turn.contentBlocks.push({ type: 'tool_use', toolId: toolCall.id });
}

function applyLegacyCommandExecution(eventType: string, item: CodexItem, turn: TurnAccumulator): void {
  if (eventType === 'item.started') {
    pushLegacyToolCall(turn, commandExecutionSeed(item));
    return;
  }

  if (eventType !== 'item.completed') {
    return;
  }

  const tc = turn.toolCalls.find(tool => tool.id === item.id);
  if (tc) {
    const rawOutput = item.aggregated_output ?? '';
    tc.result = normalizeCodexToolResult(tc.name, rawOutput);
    tc.status = item.exit_code === 0 ? 'completed' : 'error';
  }
}

function applyLegacyFileChange(eventType: string, item: CodexItem, turn: TurnAccumulator): void {
  if (eventType !== 'item.started' && eventType !== 'item.completed') {
    return;
  }

  const changes = item.changes ?? [];
  const existing = turn.toolCalls.find(tool => tool.id === item.id);
  if (!existing) {
    const paths = changes.map(change => `${change.kind}: ${change.path}`).join(', ');
    pushLegacyToolCall(turn, {
      id: item.id,
      name: normalizeCodexToolName('file_change'),
      input: { changes },
      status: item.status === 'completed' ? 'completed' : 'error',
      result: paths ? `Applied: ${paths}` : 'Applied',
    });
    return;
  }

  if (eventType === 'item.completed') {
    existing.status = item.status === 'completed' ? 'completed' : 'error';
  }
}

function applyLegacyWebSearch(eventType: string, item: CodexItem, turn: TurnAccumulator): void {
  if (eventType === 'item.started') {
    pushLegacyToolCall(turn, webSearchSeed(item));
    return;
  }

  if (eventType !== 'item.completed') {
    return;
  }

  const tc = turn.toolCalls.find(tool => tool.id === item.id);
  if (tc) {
    tc.result = 'Search complete';
    tc.status = 'completed';
  }
}

function applyLegacyMcpToolCall(eventType: string, item: CodexItem, turn: TurnAccumulator): void {
  if (eventType === 'item.started') {
    pushLegacyToolCall(turn, mcpToolCallSeed(item));
    return;
  }

  if (eventType !== 'item.completed') {
    return;
  }

  const tc = turn.toolCalls.find(tool => tool.id === item.id);
  if (tc) {
    tc.status = item.status === 'completed' ? 'completed' : 'error';
    tc.result = item.status === 'completed' ? 'Completed' : 'Failed';
  }
}

// ---------------------------------------------------------------------------
// Legacy items inside mixed/modern sessions (bubble model)
// ---------------------------------------------------------------------------

function trackToolCallOrigin(
  ctx: PersistedParseContext,
  callId: string,
  turnId: string,
  bubbleIndex: number,
): void {
  ctx.toolCallToTurn.set(callId, { turnId, bubbleIndex });
}

function ensureModernLegacyToolCall(
  ctx: PersistedParseContext,
  timestamp: number,
  item: CodexItem,
  build: () => ToolCallInfo,
): ToolCallInfo {
  const existing = findPersistedToolCallById(ctx, item.id);
  if (existing) {
    return existing;
  }

  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  const toolCall = build();
  pushToolInvocation(bubble, toolCall);
  trackToolCallOrigin(ctx, item.id, turn.id, turn.activeBubbleIndex!);
  return toolCall;
}

export function processLegacyItemInModernContext(
  eventType: string,
  item: CodexItem,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  switch (item.type) {
    case 'agent_message':
      applyModernLegacyText(eventType, item, timestamp, ctx, 'contentChunks');
      break;
    case 'reasoning':
      applyModernLegacyText(eventType, item, timestamp, ctx, 'thinkingChunks');
      break;
    case 'command_execution':
      applyModernLegacyCommandExecution(eventType, item, timestamp, ctx);
      break;
    case 'file_change':
      applyModernLegacyFileChange(eventType, item, timestamp, ctx);
      break;
    case 'web_search':
      applyModernLegacyWebSearch(eventType, item, timestamp, ctx);
      break;
    case 'mcp_tool_call':
      applyModernLegacyMcpToolCall(eventType, item, timestamp, ctx);
      break;
    default:
      break;
  }
}

function applyModernLegacyText(
  eventType: string,
  item: CodexItem,
  timestamp: number,
  ctx: PersistedParseContext,
  target: 'contentChunks' | 'thinkingChunks',
): void {
  if ((eventType !== 'item.updated' && eventType !== 'item.completed') || !item.text) {
    return;
  }

  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  replaceLatestChunk(bubble[target], item.text);
}

function isLegacyToolLifecycleEvent(eventType: string): boolean {
  return eventType === 'item.started' || eventType === 'item.completed';
}

function applyModernLegacyCommandExecution(
  eventType: string,
  item: CodexItem,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  if (!isLegacyToolLifecycleEvent(eventType)) {
    return;
  }

  const toolCall = ensureModernLegacyToolCall(ctx, timestamp, item, () => commandExecutionSeed(item));
  if (eventType !== 'item.completed') {
    return;
  }

  const rawOutput = item.aggregated_output ?? '';
  toolCall.result = normalizeCodexToolResult(toolCall.name, rawOutput);
  toolCall.status = item.exit_code === 0 ? 'completed' : 'error';
}

function applyModernLegacyFileChange(
  eventType: string,
  item: CodexItem,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  if (!isLegacyToolLifecycleEvent(eventType)) {
    return;
  }

  const changes = item.changes ?? [];
  const toolCall = ensureModernLegacyToolCall(ctx, timestamp, item, () => ({
    id: item.id,
    name: normalizeCodexToolName('file_change'),
    input: { changes },
    status: 'running',
  }));

  if (eventType === 'item.completed') {
    const paths = changes.map(change => `${change.kind}: ${change.path}`).join(', ');
    toolCall.result = paths ? `Applied: ${paths}` : 'Applied';
    toolCall.status = item.status === 'completed' ? 'completed' : 'error';
  }
}

function applyModernLegacyWebSearch(
  eventType: string,
  item: CodexItem,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  if (!isLegacyToolLifecycleEvent(eventType)) {
    return;
  }

  const toolCall = ensureModernLegacyToolCall(ctx, timestamp, item, () => webSearchSeed(item));
  if (eventType === 'item.completed') {
    toolCall.result = 'Search complete';
    toolCall.status = 'completed';
  }
}

function applyModernLegacyMcpToolCall(
  eventType: string,
  item: CodexItem,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  if (!isLegacyToolLifecycleEvent(eventType)) {
    return;
  }

  const toolCall = ensureModernLegacyToolCall(ctx, timestamp, item, () => mcpToolCallSeed(item));
  if (eventType === 'item.completed') {
    toolCall.status = item.status === 'completed' ? 'completed' : 'error';
    toolCall.result = item.status === 'completed' ? 'Completed' : 'Failed';
  }
}
