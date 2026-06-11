import * as fs from 'fs';

import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
import type {
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
  ProviderForkSupport,
} from '../../../core/providers/types';
import { buildUsageInfo, readPositiveTokenCount } from '../../../core/providers/usage';
import type { Conversation, UsageInfo } from '../../../core/types';
import { getCodexContextWindow } from '../runtime/CodexSessionFileTail';
import type { CodexProviderState } from '../types';
import { getCodexState } from '../types';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '../types/models';
import {
  type CodexParsedTurn,
  deriveCodexSessionsRootFromSessionPath,
  findCodexSessionFile,
  parseCodexSessionFile,
  parseCodexSessionTurns,
} from './CodexHistoryStore';

function readSessionTurns(sessionFilePath: string): CodexParsedTurn[] {
  let content: string;
  try {
    content = fs.readFileSync(sessionFilePath, 'utf-8');
  } catch {
    return [];
  }
  return parseCodexSessionTurns(content);
}

export class CodexConversationHistoryService extends BaseHistoryService<CodexProviderState> {
  forkSupport: ProviderForkSupport = {
    isPendingForkConversation: (conversation: Conversation): boolean => {
      const state = getCodexState(conversation.providerState);
      return !!state.forkSource && !state.threadId && !conversation.sessionId;
    },
    buildForkProviderState: (
      sourceSessionId: string,
      resumeAt: string,
      sourceProviderState?: Record<string, unknown>,
    ): Record<string, unknown> => {
      const sourceState = getCodexState(sourceProviderState);
      const sourceTranscriptRootPath = sourceState.transcriptRootPath
        ?? deriveCodexSessionsRootFromSessionPath(sourceState.sessionFilePath);
      const providerState: CodexProviderState = {
        forkSource: { sessionId: sourceSessionId, resumeAt },
        ...(sourceState.sessionFilePath ? { forkSourceSessionFilePath: sourceState.sessionFilePath } : {}),
        ...(
          sourceTranscriptRootPath
            ? { forkSourceTranscriptRootPath: sourceTranscriptRootPath }
            : {}
        ),
      };
      // CodexProviderState lacks an index signature; cast to the contract shape.
      return providerState as Record<string, unknown>;
    },
  };

  protected computeCacheKey(conversation: Conversation): string | null {
    const state = getCodexState(conversation.providerState);
    // Forks (pending or established) are never served from the generic
    // hydration cache. A thread-id-only key can't capture the resolved
    // source/fork transcript identity or content, so caching it would let a
    // stale (or fallback-partial) source-prefix + fork-only merge survive after
    // the files become resolvable or gain turns. Returning null forces
    // loadMessages to re-run the merge — and pending forks keep their in-memory
    // messages via its own short-circuit — on every hydration.
    if (state.forkSource) return null;
    const threadId = state.threadId ?? conversation.sessionId ?? null;
    const sessionFilePath = state.sessionFilePath ?? null;
    if (!sessionFilePath) return null;
    return `${threadId ?? ''}::${sessionFilePath}`;
  }

  protected async loadMessages(
    conversation: Conversation,
    _ctx: HydrationContext,
  ): Promise<HistoryLoadOutcome> {
    const state = getCodexState(conversation.providerState);
    const transcriptRootPath = state.transcriptRootPath
      ?? deriveCodexSessionsRootFromSessionPath(state.sessionFilePath);

    // Branch 1: Pending fork with existing in-memory messages → keep them.
    if (
      this.forkSupport!.isPendingForkConversation(conversation)
      && conversation.messages.length > 0
    ) {
      return {
        kind: 'cached',
        sourceRef: `pending-fork::${state.forkSource?.sessionId ?? ''}`,
      };
    }

    // Branch 2: Pending fork without messages → hydrate from source truncated at resumeAt.
    if (this.forkSupport!.isPendingForkConversation(conversation)) {
      const sourceSessionFile = this.resolveSourceSessionFile(state);
      if (!sourceSessionFile) {
        return { kind: 'empty', reason: 'no-session', sourceRef: null };
      }

      const turns = readSessionTurns(sourceSessionFile);
      const resumeAt = state.forkSource!.resumeAt;
      const truncated = this.truncateTurnsAtCheckpoint(turns, resumeAt);
      if (!truncated) {
        return {
          kind: 'error',
          error: {
            code: 'fork-checkpoint-not-found',
            message: 'Fork checkpoint (resumeAt) not found in source transcript.',
            detail: `resumeAt=${resumeAt} sourceSessionFile=${sourceSessionFile}`,
          },
          sourceRef: `pending-fork::${state.forkSource?.sessionId ?? ''}`,
        };
      }
      const messages = truncated.flatMap(t => t.messages);
      if (messages.length === 0) {
        return {
          kind: 'empty',
          reason: 'no-rows',
          sourceRef: `pending-fork::${state.forkSource?.sessionId ?? ''}`,
        };
      }
      return {
        kind: 'loaded',
        messages,
        sourceRef: `pending-fork::${state.forkSource?.sessionId ?? ''}`,
      };
    }

    // Branch 3: Established fork → source prefix (through resumeAt) + fork-only turns.
    if (state.forkSource && state.threadId) {
      const sourceSessionFile = this.resolveSourceSessionFile(state);
      const forkSessionFile = state.sessionFilePath ?? (
        state.threadId
          ? findCodexSessionFile(state.threadId, transcriptRootPath ?? undefined)
          : null
      );

      const sourceRef = `fork::${state.threadId}`;

      if (sourceSessionFile && forkSessionFile) {
        const sourceTurns = readSessionTurns(sourceSessionFile);
        const forkTurns = readSessionTurns(forkSessionFile);

        const resumeAt = state.forkSource.resumeAt;
        const sourcePrefix = this.truncateTurnsAtCheckpoint(sourceTurns, resumeAt);
        if (!sourcePrefix) {
          return {
            kind: 'error',
            error: {
              code: 'fork-checkpoint-not-found',
              message: 'Fork checkpoint (resumeAt) not found in source transcript.',
              detail: `resumeAt=${resumeAt} sourceSessionFile=${sourceSessionFile}`,
            },
            sourceRef,
          };
        }
        const sourceTurnIds = new Set(sourceTurns.map(t => t.turnId).filter(Boolean));
        const forkOnlyTurns = forkTurns.filter(t => !t.turnId || !sourceTurnIds.has(t.turnId));

        const messages = [
          ...sourcePrefix.flatMap(t => t.messages),
          ...forkOnlyTurns.flatMap(t => t.messages),
        ];

        if (messages.length === 0) {
          return { kind: 'empty', reason: 'no-rows', sourceRef };
        }
        return { kind: 'loaded', messages, sourceRef };
      }
      // Fall through: incomplete fork file resolution → treat as normal hydration.
    }

    // Branch 4: Normal hydration.
    const threadId = state.threadId ?? conversation.sessionId ?? null;
    const sessionFilePath = state.sessionFilePath ?? (
      threadId
        ? findCodexSessionFile(threadId, transcriptRootPath ?? undefined)
        : null
    );
    const resolvedTranscriptRootPath = transcriptRootPath
      ?? deriveCodexSessionsRootFromSessionPath(sessionFilePath);

    if (!sessionFilePath) {
      return { kind: 'empty', reason: 'no-session', sourceRef: null };
    }

    // Preserve the existing side-effect: backfill resolved paths into providerState so
    // subsequent reads and persistence carry the discovered transcript location.
    if (sessionFilePath !== state.sessionFilePath) {
      conversation.providerState = {
        ...(conversation.providerState ?? {}),
        ...(threadId ? { threadId } : {}),
        sessionFilePath,
        ...(resolvedTranscriptRootPath ? { transcriptRootPath: resolvedTranscriptRootPath } : {}),
      };
    } else if (resolvedTranscriptRootPath && resolvedTranscriptRootPath !== state.transcriptRootPath) {
      conversation.providerState = {
        ...(conversation.providerState ?? {}),
        ...(threadId ? { threadId } : {}),
        transcriptRootPath: resolvedTranscriptRootPath,
      };
    }

    const sourceRef = `${threadId ?? ''}::${sessionFilePath}`;
    const sdkMessages = parseCodexSessionFile(sessionFilePath);
    if (sdkMessages.length === 0) {
      return { kind: 'empty', reason: 'no-rows', sourceRef };
    }
    return { kind: 'loaded', messages: sdkMessages, sourceRef };
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) return null;
    const state = getCodexState(conversation.providerState);
    return state.threadId ?? conversation.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _ctx: HydrationContext,
  ): Promise<DeleteHistoryOutcome> {
    // ~/.codex transcripts are provider-owned; never delete them.
    return { kind: 'no-op', reason: 'provider-owned' };
  }

  /**
   * Recovers the most recent `UsageInfo` from the Codex session JSONL by
   * walking it back to front. Looks for the latest `event_msg/token_count`
   * (carries `last_token_usage`) and the latest `task_started` (carries
   * `model_context_window`, authoritative when present).
   *
   * Returns null when the session file is missing, unreadable, or contains
   * no usable token_count event.
   */
  async extractLastUsage(
    conversation: Conversation,
    _ctx: HydrationContext,
  ): Promise<UsageInfo | null> {
    try {
      const state = getCodexState(conversation.providerState);
      const transcriptRootPath = state.transcriptRootPath
        ?? deriveCodexSessionsRootFromSessionPath(state.sessionFilePath);
      const threadId = state.threadId ?? conversation.sessionId ?? null;
      const sessionFilePath = state.sessionFilePath ?? (
        threadId
          ? findCodexSessionFile(threadId, transcriptRootPath ?? undefined)
          : null
      );
      if (!sessionFilePath) return null;

      let content: string;
      try {
        content = fs.readFileSync(sessionFilePath, 'utf-8');
      } catch {
        return null;
      }

      return extractLastUsageFromCodexJsonl(content);
    } catch {
      return null;
    }
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): CodexProviderState | undefined {
    const entries = Object.entries(getCodexState(conversation.providerState))
      .filter(([, value]) => value !== undefined);
    return entries.length > 0
      ? Object.fromEntries(entries) as CodexProviderState
      : undefined;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveSourceSessionFile(state: CodexProviderState): string | null {
    if (!state.forkSource) return null;
    const sourceTranscriptRootPath = state.forkSourceTranscriptRootPath
      ?? deriveCodexSessionsRootFromSessionPath(state.forkSourceSessionFilePath);
    return state.forkSourceSessionFilePath
      ?? findCodexSessionFile(state.forkSource.sessionId, sourceTranscriptRootPath ?? undefined);
  }

  private truncateTurnsAtCheckpoint(
    turns: CodexParsedTurn[],
    resumeAt: string,
  ): CodexParsedTurn[] | null {
    const checkpointIndex = turns.findIndex(turn => turn.turnId === resumeAt);
    if (checkpointIndex < 0) {
      return null;
    }

    return turns.slice(0, checkpointIndex + 1);
  }
}

// ---------------------------------------------------------------------------
// extractLastUsage helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface CodexLastTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

function readLastTokenUsageBlock(payload: Record<string, unknown>): CodexLastTokenUsage | null {
  const info = isRecord(payload.info) ? payload.info : null;
  if (!info) return null;
  const lastTokenUsage = isRecord(info.last_token_usage) ? info.last_token_usage : null;
  if (!lastTokenUsage) return null;

  return {
    inputTokens: readPositiveTokenCount(lastTokenUsage.input_tokens ?? lastTokenUsage.input),
    cachedInputTokens: readPositiveTokenCount(lastTokenUsage.cached_input_tokens ?? lastTokenUsage.cached_input),
    outputTokens: readPositiveTokenCount(lastTokenUsage.output_tokens ?? lastTokenUsage.output),
    reasoningOutputTokens: readPositiveTokenCount(
      lastTokenUsage.reasoning_output_tokens ?? lastTokenUsage.reasoning_output,
    ),
  };
}

export function extractLastUsageFromCodexJsonl(content: string): UsageInfo | null {
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  if (lines.length === 0) return null;

  let lastTokenUsage: CodexLastTokenUsage | null = null;
  let modelContextWindow: number | null = null;
  let model: string | null = null;

  // Walk back to front so the most recent records win.
  for (let i = lines.length - 1; i >= 0; i--) {
    let parsed: Record<string, unknown>;
    try {
      const rawParsed = JSON.parse(lines[i]) as unknown;
      if (!isRecord(rawParsed)) continue;
      parsed = rawParsed;
    } catch {
      continue;
    }

    const payload = isRecord(parsed.payload) ? parsed.payload : parsed;

    if (parsed.type === 'event_msg' && payload.type === 'token_count' && !lastTokenUsage) {
      lastTokenUsage = readLastTokenUsageBlock(payload);
      continue;
    }

    if (parsed.type === 'event_msg' && payload.type === 'task_started') {
      if (modelContextWindow === null) {
        const window = payload.model_context_window;
        if (typeof window === 'number' && window > 0) {
          modelContextWindow = window;
        }
      }
      continue;
    }

    if (!model) {
      // Codex session files can stamp model id on session_meta, turn_context, or
      // legacy event wrappers. Accept any record carrying a `model` string field.
      const candidate = payload.model ?? parsed.model;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        model = candidate.trim();
      }
    }

    if (lastTokenUsage && modelContextWindow !== null && model) break;
  }

  if (!lastTokenUsage) return null;

  const resolvedModel = model ?? DEFAULT_CODEX_PRIMARY_MODEL;
  const inputTokens = lastTokenUsage.inputTokens;
  const outputTokens = lastTokenUsage.outputTokens;
  const reasoningOutputTokens = lastTokenUsage.reasoningOutputTokens;
  const cacheReadInputTokens = lastTokenUsage.cachedInputTokens;
  // contextTokens = input + output + reasoning. cached_input is part of input
  // on the wire, so don't add it again. Mirrors CodexSessionFileTail.buildUsageInfo.
  const contextTokens = inputTokens + outputTokens + reasoningOutputTokens;
  const contextWindow = modelContextWindow ?? getCodexContextWindow(resolvedModel);
  const contextWindowIsAuthoritative = modelContextWindow !== null;

  return buildUsageInfo({
    model: resolvedModel,
    inputTokens,
    outputTokens: outputTokens > 0 ? outputTokens : undefined,
    reasoningOutputTokens: reasoningOutputTokens > 0 ? reasoningOutputTokens : undefined,
    cacheReadInputTokens: cacheReadInputTokens > 0 ? cacheReadInputTokens : undefined,
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative,
  });
}
