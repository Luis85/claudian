import type { PersistedParseContext } from './codexTurnState';
import {
  appendUniqueChunk,
  appendUserChunk,
  closeAssistantBubble,
  ensureAssistantBubble,
  ensureTurn,
  nextTurnId,
} from './codexTurnState';

export interface PersistedEventPayload {
  type?: string;
  text?: string;
  message?: string;
}

interface CodexReasoningExtractor {
  extractReasoningText(payload: PersistedEventPayload): string;
}

function extractServerTurnId(payload: PersistedEventPayload): string | undefined {
  const turnId = (payload as Record<string, unknown>).turn_id;
  return typeof turnId === 'string' ? turnId : undefined;
}

function handleTaskStarted(
  payload: PersistedEventPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const serverTurnId = extractServerTurnId(payload);
  const id = nextTurnId(ctx);
  const turn = ensureTurn(ctx.turns, ctx.turnOrder, id, null, timestamp);
  turn.startedAt = timestamp;
  if (serverTurnId) turn.serverTurnId = serverTurnId;
  ctx.currentTurnId = turn.id;
}

function handleTaskComplete(
  payload: PersistedEventPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  if (ctx.currentTurnId) {
    const turn = ctx.turns.get(ctx.currentTurnId);
    if (turn) {
      turn.completedAt = timestamp;
      turn.completed = true;
      closeAssistantBubble(turn);
      const serverTurnId = extractServerTurnId(payload);
      if (serverTurnId && !turn.serverTurnId) turn.serverTurnId = serverTurnId;
    }
  }
  ctx.currentTurnId = null;
}

function handleTurnAborted(timestamp: number, ctx: PersistedParseContext): void {
  if (ctx.currentTurnId) {
    const turn = ctx.turns.get(ctx.currentTurnId);
    if (turn) {
      const bubble = ensureAssistantBubble(turn, timestamp);
      bubble.interrupted = true;
      closeAssistantBubble(turn);
      turn.completedAt = timestamp;
    }
  }
  ctx.currentTurnId = null;
}

function handleUserMessage(
  payload: PersistedEventPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const msg = payload.message;
  if (typeof msg === 'string' && msg.trim()) {
    appendUserChunk(turn, msg, timestamp);
  }
}

function handleAgentMessage(
  payload: PersistedEventPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  const msg = payload.message;
  if (typeof msg === 'string') {
    appendUniqueChunk(bubble.contentChunks, msg);
  }
}

function handleAgentReasoning(
  payload: PersistedEventPayload,
  timestamp: number,
  ctx: PersistedParseContext,
  extractor: CodexReasoningExtractor,
): void {
  const text = extractor.extractReasoningText(payload);
  if (!text) return;

  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  appendUniqueChunk(bubble.thinkingChunks, text);
}

function handleContextCompacted(timestamp: number, ctx: PersistedParseContext): void {
  // Close any active bubble so the boundary stays standalone
  if (ctx.currentTurnId) {
    const prevTurn = ctx.turns.get(ctx.currentTurnId);
    if (prevTurn) closeAssistantBubble(prevTurn);
  }

  // Create a dedicated turn for the compact boundary
  const id = nextTurnId(ctx);
  const turn = ensureTurn(ctx.turns, ctx.turnOrder, id, null, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  bubble.contentBlocks.push({ type: 'context_compacted' });
  closeAssistantBubble(turn);
  ctx.currentTurnId = null;
}

export function processEventMsg(
  payload: PersistedEventPayload,
  timestamp: number,
  ctx: PersistedParseContext,
  extractor: CodexReasoningExtractor,
): void {
  if (!payload?.type) return;

  switch (payload.type) {
    case 'task_started':
      handleTaskStarted(payload, timestamp, ctx);
      break;
    case 'task_complete':
      handleTaskComplete(payload, timestamp, ctx);
      break;
    case 'turn_aborted':
      handleTurnAborted(timestamp, ctx);
      break;
    case 'user_message':
      handleUserMessage(payload, timestamp, ctx);
      break;
    case 'agent_message':
      handleAgentMessage(payload, timestamp, ctx);
      break;
    case 'agent_reasoning':
      handleAgentReasoning(payload, timestamp, ctx, extractor);
      break;
    case 'context_compacted':
      handleContextCompacted(timestamp, ctx);
      break;
    default:
      break;
  }
}
