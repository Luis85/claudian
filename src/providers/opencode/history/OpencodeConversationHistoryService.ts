import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
import type {
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
} from '../../../core/providers/types';
import { buildUsageInfo } from '../../../core/providers/usage';
import type { Conversation, UsageInfo } from '../../../core/types';
import { getOpencodeState, type OpencodeProviderState } from '../types';
import {
  loadOpencodeLastAssistantData,
  loadOpencodeSessionMessages,
} from './OpencodeHistoryStore';

export class OpencodeConversationHistoryService extends BaseHistoryService<OpencodeProviderState> {
  // forkSupport intentionally omitted — Opencode capabilities.supportsFork === false.

  protected computeCacheKey(conversation: Conversation): string | null {
    if (!conversation.sessionId) return null;
    const state = getOpencodeState(conversation.providerState);
    return `${conversation.sessionId}::${state.databasePath ?? ''}`;
  }

  protected async loadMessages(
    conversation: Conversation,
    _ctx: HydrationContext,
  ): Promise<HistoryLoadOutcome> {
    const sessionId = conversation.sessionId;
    if (!sessionId) return { kind: 'empty', reason: 'no-session', sourceRef: null };

    const state = getOpencodeState(conversation.providerState);
    const sourceRef = `${sessionId}::${state.databasePath ?? ''}`;
    const result = await loadOpencodeSessionMessages(sessionId, state);

    if (result.error) {
      return { kind: 'error', error: result.error, sourceRef };
    }
    if (result.messages.length === 0) {
      return { kind: 'empty', reason: 'no-rows', sourceRef };
    }
    return { kind: 'loaded', messages: result.messages, sourceRef };
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  async deleteConversationSessionV2(
    _conversation: Conversation,
    _ctx: HydrationContext,
  ): Promise<DeleteHistoryOutcome> {
    // Never mutate OpenCode native history (it is provider-owned by design).
    return { kind: 'no-op', reason: 'provider-owned' };
  }

  buildPersistedProviderState(conversation: Conversation): OpencodeProviderState | undefined {
    const state = getOpencodeState(conversation.providerState);
    const providerState: OpencodeProviderState = {
      ...(state.databasePath ? { databasePath: state.databasePath } : {}),
    };
    return Object.keys(providerState).length > 0 ? providerState : undefined;
  }

  /**
   * Recovers the most recent `UsageInfo` from the OpenCode SQLite store. We
   * pull only the last assistant `message.data` JSON for the session and parse
   * its `tokens` block (input/output/reasoning + cache.read/write) and
   * `modelID`. Falls back to null when the store is unavailable or the row
   * lacks usable token data.
   */
  async extractLastUsage(
    conversation: Conversation,
    _ctx: HydrationContext,
  ): Promise<UsageInfo | null> {
    try {
      const sessionId = conversation.sessionId;
      if (!sessionId) return null;
      const state = getOpencodeState(conversation.providerState);

      const data = await loadOpencodeLastAssistantData(sessionId, state);
      if (!data) return null;

      return extractLastUsageFromOpencodeMessageData(data);
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function extractLastUsageFromOpencodeMessageData(
  data: Record<string, unknown>,
): UsageInfo | null {
  const tokens = isRecord(data.tokens) ? data.tokens : null;
  if (!tokens) return null;

  const modelID = typeof data.modelID === 'string' && data.modelID.trim().length > 0
    ? data.modelID.trim()
    : typeof data.providerID === 'string' && typeof data.modelID === 'string'
      ? data.modelID
      : null;
  if (!modelID) return null;

  const inputTokens = readNumber(tokens.input);
  const outputTokens = readNumber(tokens.output);
  const reasoningTokens = readNumber(tokens.reasoning);
  const cache = isRecord(tokens.cache) ? tokens.cache : null;
  const cacheReadTokens = readNumber(cache?.read);
  const cacheWriteTokens = readNumber(cache?.write);

  if (
    inputTokens === 0
    && outputTokens === 0
    && reasoningTokens === 0
    && cacheReadTokens === 0
    && cacheWriteTokens === 0
  ) {
    return null;
  }

  // OpenCode's wire shape includes prompt-side caching tokens separately from
  // `input` (mirrors AcpUsage.cachedReadTokens). contextTokens sums the actual
  // input components.
  const contextTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const costUsd = typeof data.cost === 'number' && Number.isFinite(data.cost)
    ? data.cost
    : undefined;

  return buildUsageInfo({
    model: modelID,
    inputTokens,
    outputTokens: outputTokens > 0 ? outputTokens : undefined,
    thoughtTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
    cacheReadInputTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
    cacheCreationInputTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
    contextTokens,
    // OpenCode persists `cost` and `tokens` but no context-window field; the
    // catalog window the runtime uses isn't recorded in the row.
    contextWindow: 0,
    contextWindowIsAuthoritative: false,
    costUsd,
  });
}
