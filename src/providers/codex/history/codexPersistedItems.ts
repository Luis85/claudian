/**
 * Per-item handlers for the persisted (`response_item`) parse path, split out of
 * {@link CodexHistoryStore} to keep that grandfathered module shrinking and to
 * isolate the message/reasoning branching that drives `processPersistedPayload`'s
 * cognitive complexity. Text extraction stays owned by the store and is injected
 * here (same pattern as `processEventMsg`/`flushBubbleTurnMessages`) so this
 * module never imports back into the store.
 *
 * Behaviour is identical to the original inline switch arms, including:
 * - skipping Codex system messages on the user branch;
 * - closing the previous turn's active assistant bubble before a new user turn;
 * - resetting `currentTurnId` to null so the user message opens a fresh turn.
 */
import type { PersistedParseContext } from './codexTurnState';
import {
  appendUniqueChunk,
  appendUserChunk,
  closeAssistantBubble,
  ensureAssistantBubble,
  ensureTurn,
  nextTurnId,
} from './codexTurnState';

interface PersistedMessageLike {
  role?: string;
  content?: Array<{ text?: string }> | undefined;
}

export interface PersistedItemTextExtractors {
  extractMessageText(content: Array<{ text?: string }> | undefined): string;
  isCodexSystemMessage(text: string): boolean;
  extractReasoningText(payload: unknown): string;
}

export function processPersistedMessagePayload(
  payload: PersistedMessageLike,
  timestamp: number,
  ctx: PersistedParseContext,
  extractors: PersistedItemTextExtractors,
): void {
  const text = extractors.extractMessageText(payload.content);

  if (payload.role === 'user') {
    if (extractors.isCodexSystemMessage(text)) return;

    // Close any active bubble in the current turn before starting user content
    if (ctx.currentTurnId) {
      const prevTurn = ctx.turns.get(ctx.currentTurnId);
      if (prevTurn) closeAssistantBubble(prevTurn);
    }

    // User message opens a new turn
    ctx.currentTurnId = null;
    const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), null, timestamp);
    ctx.currentTurnId = turn.id;
    if (text) {
      appendUserChunk(turn, text, timestamp);
    }
    return;
  }

  if (payload.role === 'assistant') {
    const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
    const bubble = ensureAssistantBubble(turn, timestamp);
    if (text) {
      appendUniqueChunk(bubble.contentChunks, text);
    }
  }
}

export function processPersistedReasoningPayload(
  payload: unknown,
  timestamp: number,
  ctx: PersistedParseContext,
  extractors: PersistedItemTextExtractors,
): void {
  const text = extractors.extractReasoningText(payload);
  if (!text) return;

  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  appendUniqueChunk(bubble.thinkingChunks, text);
}
