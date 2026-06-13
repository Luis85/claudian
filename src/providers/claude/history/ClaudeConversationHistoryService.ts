import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
import type {
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
  ProviderForkSupport,
} from '../../../core/providers/types';
import { buildUsageInfo } from '../../../core/providers/usage';
import type {
  ChatMessage,
  Conversation,
  ForkSource,
  UsageInfo,
} from '../../../core/types';
import { getContextWindowSize } from '../types/models';
import { type ClaudeProviderState, getClaudeState } from '../types/providerState';
import {
  deleteSDKSession,
  getSDKSessionPath,
  loadSDKSessionMessages,
  readSDKSession,
  sdkSessionExists,
} from './ClaudeHistoryStore';
import {
  applySubagentData,
  buildPersistedSubagentData,
  enrichAsyncSubagentToolCalls,
} from './claudeSubagentHydration';

function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];

  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    result.push(message);
  }

  return result;
}

function sanitizeProviderState(
  providerState: ClaudeProviderState,
): Record<string, unknown> | undefined {
  const sanitizedEntries = Object.entries(providerState).filter(([, value]) => value !== undefined);
  if (sanitizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(sanitizedEntries);
}

export class ClaudeConversationHistoryService extends BaseHistoryService<ClaudeProviderState> {
  forkSupport: ProviderForkSupport = {
    isPendingForkConversation: (conversation: Conversation): boolean => {
      const state = getClaudeState(conversation.providerState);
      return !!state.forkSource
        && !state.providerSessionId
        && !conversation.sessionId;
    },
    buildForkProviderState: (
      sourceSessionId: string,
      resumeAt: string,
      _sourceProviderState?: Record<string, unknown>,
    ): Record<string, unknown> => {
      const state: ClaudeProviderState = {
        forkSource: { sessionId: sourceSessionId, resumeAt } satisfies ForkSource,
      };
      return state as Record<string, unknown>;
    },
  };

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) return null;
    const state = getClaudeState(conversation.providerState);
    return state.providerSessionId ?? conversation.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): ClaudeProviderState | undefined {
    const providerState: ClaudeProviderState = {
      ...getClaudeState(conversation.providerState),
    };

    const subagentData = buildPersistedSubagentData(conversation.messages);
    if (Object.keys(subagentData).length > 0) {
      providerState.subagentData = subagentData;
    } else {
      delete providerState.subagentData;
    }

    return sanitizeProviderState(providerState) as ClaudeProviderState | undefined;
  }

  protected computeCacheKey(
    conversation: Conversation,
    ctx: HydrationContext,
  ): string | null {
    if (!ctx.vaultPath) return null;
    const state = getClaudeState(conversation.providerState);
    const isPendingFork = this.forkSupport!.isPendingForkConversation(conversation);
    const sessionIds = isPendingFork
      ? [state.forkSource!.sessionId]
      : [
          ...(state.previousProviderSessionIds || []),
          state.providerSessionId ?? conversation.sessionId,
        ].filter((id): id is string => !!id);
    if (sessionIds.length === 0) return null;
    const composite = sessionIds.join('|');
    // Rewind invariant (Plan EDIT 5): include resumeAtMessageId so a rewind on the same
    // session invalidates the cache and re-truncates the SDK transcript.
    const resumeMarker = conversation.resumeAtMessageId ?? '';
    return `${ctx.vaultPath}::${composite}::${resumeMarker}`;
  }

  protected async loadMessages(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<HistoryLoadOutcome> {
    if (!ctx.vaultPath) {
      return { kind: 'empty', reason: 'no-session', sourceRef: null };
    }
    const vaultPath = ctx.vaultPath;

    const state = getClaudeState(conversation.providerState);
    const isPendingFork = this.forkSupport!.isPendingForkConversation(conversation);
    const allSessionIds: string[] = isPendingFork
      ? [state.forkSource!.sessionId]
      : [
          ...(state.previousProviderSessionIds || []),
          state.providerSessionId ?? conversation.sessionId,
        ].filter((id): id is string => !!id);

    if (allSessionIds.length === 0) {
      return { kind: 'empty', reason: 'no-session', sourceRef: null };
    }

    const currentSessionId = isPendingFork
      ? state.forkSource!.sessionId
      : (state.providerSessionId ?? conversation.sessionId);
    const sourceRef = allSessionIds.join('|');

    const allSdkMessages: ChatMessage[] = [];
    let missingSessionCount = 0;
    let errorCount = 0;
    let successCount = 0;

    for (const sessionId of allSessionIds) {
      // Plan EDIT 7: mid-load abort. Check before each session read so a long
      // multi-session walk releases promptly when the tab is switched.
      if (ctx.signal?.aborted) {
        return {
          kind: 'error',
          error: { code: 'cancelled', message: 'Hydration cancelled' },
          sourceRef,
        };
      }

      if (!sdkSessionExists(vaultPath, sessionId)) {
        missingSessionCount++;
        continue;
      }

      const isCurrentSession = sessionId === currentSessionId;
      const truncateAt = isCurrentSession
        ? (isPendingFork ? state.forkSource!.resumeAt : conversation.resumeAtMessageId)
        : undefined;
      const result = await loadSDKSessionMessages(vaultPath, sessionId, truncateAt);

      if (result.error) {
        errorCount++;
        continue;
      }

      successCount++;
      allSdkMessages.push(...result.messages);
    }

    const allSessionsMissing = missingSessionCount === allSessionIds.length;
    if (allSessionsMissing) {
      return { kind: 'empty', reason: 'no-session', sourceRef };
    }

    if (errorCount > 0 && successCount === 0) {
      return {
        kind: 'error',
        error: {
          code: 'store-unreadable',
          message: 'Failed to read Claude SDK session transcripts.',
        },
        sourceRef,
      };
    }

    const filteredSdkMessages = allSdkMessages.filter(msg => !msg.isRebuiltContext);

    const merged = dedupeMessages([
      ...conversation.messages,
      ...filteredSdkMessages,
    ]).sort((a, b) => a.timestamp - b.timestamp);

    if (state.subagentData) {
      await enrichAsyncSubagentToolCalls(
        state.subagentData,
        vaultPath,
        allSessionIds,
      );
      applySubagentData(merged, state.subagentData);
    }

    return { kind: 'loaded', messages: merged, sourceRef };
  }

  async deleteConversationSession(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<DeleteHistoryOutcome> {
    const state = getClaudeState(conversation.providerState);
    const sessionId = state.providerSessionId ?? conversation.sessionId;
    if (!ctx.vaultPath || !sessionId) {
      return { kind: 'no-op', reason: 'no-session' };
    }

    await deleteSDKSession(ctx.vaultPath, sessionId);
    // `getSDKSessionPath` validates the id; fall back to the bare id if validation rejects it
    // (deleteSDKSession is best-effort and already swallows the same error class).
    let resolvedPath = sessionId;
    try {
      resolvedPath = getSDKSessionPath(ctx.vaultPath, sessionId);
    } catch {
      // keep sessionId fallback
    }
    return { kind: 'deleted', paths: [resolvedPath] };
  }

  /**
   * Recovers the most recent `UsageInfo` from the persisted JSONL transcript.
   *
   * Scan strategy (walk the raw SDK rows back to front):
   * - The last `result` row carries `modelUsage[model].contextWindow` — when
   *   present, that's the authoritative window for the matching model.
   * - The last main-agent `assistant` row (no `parent_tool_use_id`) carries
   *   `message.usage` (input + cache_creation + cache_read) and the model id.
   *   Subagent assistant rows are excluded so we don't conflate windows.
   *
   * Returns null if neither row is found or any parse step fails.
   */
  async extractLastUsage(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<UsageInfo | null> {
    try {
      if (!ctx.vaultPath) return null;
      const state = getClaudeState(conversation.providerState);
      const sessionId = state.providerSessionId ?? conversation.sessionId;
      if (!sessionId) return null;

      const session = await readSDKSession(ctx.vaultPath, sessionId);
      if (session.error || session.messages.length === 0) return null;

      return extractLastUsageFromSdkMessages(
        session.messages as unknown as Record<string, unknown>[],
      );
    } catch {
      return null;
    }
  }
}

interface ClaudeMessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNonNegInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readNestedUsage(msg: Record<string, unknown>): ClaudeMessageUsage | null {
  if (!isRecord(msg.message)) return null;
  const usage = (msg.message as Record<string, unknown>).usage;
  if (!isRecord(usage)) return null;
  return usage as ClaudeMessageUsage;
}

function readNestedModel(msg: Record<string, unknown>): string | undefined {
  if (!isRecord(msg.message)) return undefined;
  const model = (msg.message as Record<string, unknown>).model;
  return typeof model === 'string' && model.trim().length > 0 ? model.trim() : undefined;
}

function readModelUsageMap(msg: Record<string, unknown>): Record<string, { contextWindow?: number }> | null {
  if (!isRecord(msg.modelUsage)) return null;
  return msg.modelUsage as Record<string, { contextWindow?: number }>;
}

function isMainAgentAssistant(msg: Record<string, unknown>): boolean {
  const parent = msg.parent_tool_use_id;
  return parent === null || parent === undefined;
}

export function extractLastUsageFromSdkMessages(
  messages: readonly Record<string, unknown>[],
): UsageInfo | null {
  // Walk back to front. Capture the latest result-message modelUsage (carries
  // authoritative contextWindow) and the latest main-agent assistant usage.
  let lastAssistantUsage: ClaudeMessageUsage | null = null;
  let lastAssistantModel: string | undefined;
  let lastResultModelUsage: Record<string, { contextWindow?: number }> | null = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isRecord(msg)) continue;

    if (msg.type === 'result' && !lastResultModelUsage) {
      const modelUsage = readModelUsageMap(msg);
      if (modelUsage) {
        lastResultModelUsage = modelUsage;
      }
      continue;
    }

    if (msg.type === 'assistant' && !lastAssistantUsage && isMainAgentAssistant(msg)) {
      const usage = readNestedUsage(msg);
      if (usage) {
        lastAssistantUsage = usage;
        lastAssistantModel = readNestedModel(msg);
      }
    }

    if (lastAssistantUsage && lastResultModelUsage) break;
  }

  if (!lastAssistantUsage) return null;
  const model = lastAssistantModel;
  if (!model) return null;

  const inputTokens = normalizeNonNegInteger(lastAssistantUsage.input_tokens);
  const outputTokens = normalizeNonNegInteger(lastAssistantUsage.output_tokens);
  const cacheCreationInputTokens = normalizeNonNegInteger(lastAssistantUsage.cache_creation_input_tokens);
  const cacheReadInputTokens = normalizeNonNegInteger(lastAssistantUsage.cache_read_input_tokens);
  const contextTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;

  // Resolve context window: prefer result-message authoritative entry for the
  // same model; fall back to the model's heuristic window.
  let contextWindow = getContextWindowSize(model);
  let contextWindowIsAuthoritative = false;
  if (lastResultModelUsage) {
    const entry = lastResultModelUsage[model];
    const entryWindow = entry?.contextWindow;
    if (typeof entryWindow === 'number' && entryWindow > 0) {
      contextWindow = entryWindow;
      contextWindowIsAuthoritative = true;
    } else {
      // Single-entry case: trust it even if the model id doesn't literal-match.
      const entries = Object.values(lastResultModelUsage)
        .filter((u): u is { contextWindow: number } =>
          typeof u?.contextWindow === 'number' && u.contextWindow > 0);
      if (entries.length === 1) {
        contextWindow = entries[0].contextWindow;
        contextWindowIsAuthoritative = true;
      }
    }
  }

  return buildUsageInfo({
    model,
    inputTokens,
    outputTokens: outputTokens > 0 ? outputTokens : undefined,
    cacheCreationInputTokens: cacheCreationInputTokens > 0 ? cacheCreationInputTokens : undefined,
    cacheReadInputTokens: cacheReadInputTokens > 0 ? cacheReadInputTokens : undefined,
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative,
  });
}
