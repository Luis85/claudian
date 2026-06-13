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

function pendingForkSourceRef(state: CodexProviderState): string {
  return `pending-fork::${state.forkSource?.sessionId ?? ''}`;
}

function resolveSessionTarget(
  state: CodexProviderState,
  conversationSessionId: string | null,
  transcriptRootPath: string | null,
): { threadId: string | null; sessionFilePath: string | null } {
  const threadId = state.threadId ?? conversationSessionId ?? null;
  const sessionFilePath = state.sessionFilePath ?? (
    threadId
      ? findCodexSessionFile(threadId, transcriptRootPath ?? undefined)
      : null
  );
  return { threadId, sessionFilePath };
}

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
      return { kind: 'cached', sourceRef: pendingForkSourceRef(state) };
    }

    // Branch 2: Pending fork without messages → hydrate from source truncated at resumeAt.
    if (this.forkSupport!.isPendingForkConversation(conversation)) {
      return this.loadPendingForkMessages(state);
    }

    // Branch 3: Established fork → source prefix (through resumeAt) + fork-only turns.
    if (state.forkSource && state.threadId) {
      const outcome = this.loadEstablishedForkMessages(state, transcriptRootPath);
      if (outcome) return outcome;
      // Fall through: incomplete fork file resolution → treat as normal hydration.
    }

    // Branch 4: Normal hydration.
    return this.loadNormalHydrationMessages(conversation, state, transcriptRootPath);
  }

  private loadPendingForkMessages(state: CodexProviderState): HistoryLoadOutcome {
    const sourceSessionFile = this.resolveSourceSessionFile(state);
    if (!sourceSessionFile) {
      return { kind: 'empty', reason: 'no-session', sourceRef: null };
    }

    const sourceRef = pendingForkSourceRef(state);
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
        sourceRef,
      };
    }
    const messages = truncated.flatMap(t => t.messages);
    if (messages.length === 0) {
      return { kind: 'empty', reason: 'no-rows', sourceRef };
    }
    return { kind: 'loaded', messages, sourceRef };
  }

  /** Returns null when fork file resolution is incomplete → caller falls back to normal hydration. */
  private loadEstablishedForkMessages(
    state: CodexProviderState,
    transcriptRootPath: string | null,
  ): HistoryLoadOutcome | null {
    const sourceSessionFile = this.resolveSourceSessionFile(state);
    const forkSessionFile = state.sessionFilePath ?? (
      state.threadId
        ? findCodexSessionFile(state.threadId, transcriptRootPath ?? undefined)
        : null
    );

    const sourceRef = `fork::${state.threadId}`;

    if (!sourceSessionFile || !forkSessionFile) {
      return null;
    }

    const sourceTurns = readSessionTurns(sourceSessionFile);
    const forkTurns = readSessionTurns(forkSessionFile);

    const resumeAt = state.forkSource!.resumeAt;
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

  private loadNormalHydrationMessages(
    conversation: Conversation,
    state: CodexProviderState,
    transcriptRootPath: string | null,
  ): HistoryLoadOutcome {
    const { threadId, sessionFilePath } = resolveSessionTarget(
      state,
      conversation.sessionId,
      transcriptRootPath,
    );
    const resolvedTranscriptRootPath = transcriptRootPath
      ?? deriveCodexSessionsRootFromSessionPath(sessionFilePath);

    if (!sessionFilePath) {
      return { kind: 'empty', reason: 'no-session', sourceRef: null };
    }

    this.backfillResolvedPaths(conversation, state, threadId, sessionFilePath, resolvedTranscriptRootPath);

    const sourceRef = `${threadId ?? ''}::${sessionFilePath}`;
    const sdkMessages = parseCodexSessionFile(sessionFilePath);
    if (sdkMessages.length === 0) {
      return { kind: 'empty', reason: 'no-rows', sourceRef };
    }
    return { kind: 'loaded', messages: sdkMessages, sourceRef };
  }

  // Preserve the existing side-effect: backfill resolved paths into providerState so
  // subsequent reads and persistence carry the discovered transcript location.
  private backfillResolvedPaths(
    conversation: Conversation,
    state: CodexProviderState,
    threadId: string | null,
    sessionFilePath: string,
    resolvedTranscriptRootPath: string | null,
  ): void {
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

interface CodexJsonlRecord {
  parsed: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/** Parses one JSONL line into its record + payload, or null when unusable. */
function parseCodexJsonlRecord(line: string): CodexJsonlRecord | null {
  let parsed: Record<string, unknown>;
  try {
    const rawParsed = JSON.parse(line) as unknown;
    if (!isRecord(rawParsed)) return null;
    parsed = rawParsed;
  } catch {
    return null;
  }
  const payload = isRecord(parsed.payload) ? parsed.payload : parsed;
  return { parsed, payload };
}

/** Positive `model_context_window` from a `task_started` payload, else null. */
function readModelContextWindow(payload: Record<string, unknown>): number | null {
  const window = payload.model_context_window;
  return typeof window === 'number' && window > 0 ? window : null;
}

/**
 * Codex session files can stamp model id on session_meta, turn_context, or
 * legacy event wrappers. Accept any record carrying a non-empty `model` string.
 */
function readModelId(record: CodexJsonlRecord): string | null {
  const candidate = record.payload.model ?? record.parsed.model;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return null;
}

interface CodexUsageScanState {
  lastTokenUsage: CodexLastTokenUsage | null;
  modelContextWindow: number | null;
  model: string | null;
}

/** True once every field a back-to-front scan can still discover is resolved. */
function isCodexUsageScanComplete(state: CodexUsageScanState): boolean {
  return state.lastTokenUsage !== null && state.modelContextWindow !== null && state.model !== null;
}

/**
 * Folds one parsed record into the scan state. Each field keeps its first
 * (i.e. most recent, since the caller walks back to front) discovered value.
 */
function accumulateCodexUsageRecord(state: CodexUsageScanState, record: CodexJsonlRecord): void {
  const { parsed, payload } = record;
  const isEventMsg = parsed.type === 'event_msg';

  if (isEventMsg && payload.type === 'token_count' && !state.lastTokenUsage) {
    state.lastTokenUsage = readLastTokenUsageBlock(payload);
    return;
  }

  if (isEventMsg && payload.type === 'task_started') {
    if (state.modelContextWindow === null) {
      state.modelContextWindow = readModelContextWindow(payload);
    }
    return;
  }

  if (!state.model) {
    state.model = readModelId(record);
  }
}

/** Walks the JSONL lines back to front, accumulating the latest usage fields. */
function scanCodexUsage(lines: string[]): CodexUsageScanState {
  const state: CodexUsageScanState = {
    lastTokenUsage: null,
    modelContextWindow: null,
    model: null,
  };
  for (let i = lines.length - 1; i >= 0; i--) {
    const record = parseCodexJsonlRecord(lines[i]);
    if (!record) continue;
    accumulateCodexUsageRecord(state, record);
    if (isCodexUsageScanComplete(state)) break;
  }
  return state;
}

/** Assembles the final `UsageInfo` from a completed (token-usage-bearing) scan. */
function buildCodexUsageInfo(
  lastTokenUsage: CodexLastTokenUsage,
  modelContextWindow: number | null,
  model: string | null,
): UsageInfo {
  const resolvedModel = model ?? DEFAULT_CODEX_PRIMARY_MODEL;
  const { inputTokens, outputTokens, reasoningOutputTokens, cachedInputTokens } = lastTokenUsage;
  // contextTokens = input + output + reasoning. cached_input is part of input
  // on the wire, so don't add it again. Mirrors CodexSessionFileTail.buildUsageInfo.
  const contextTokens = inputTokens + outputTokens + reasoningOutputTokens;
  const contextWindow = modelContextWindow ?? getCodexContextWindow(resolvedModel);

  return buildUsageInfo({
    model: resolvedModel,
    inputTokens,
    outputTokens: outputTokens > 0 ? outputTokens : undefined,
    reasoningOutputTokens: reasoningOutputTokens > 0 ? reasoningOutputTokens : undefined,
    cacheReadInputTokens: cachedInputTokens > 0 ? cachedInputTokens : undefined,
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: modelContextWindow !== null,
  });
}

export function extractLastUsageFromCodexJsonl(content: string): UsageInfo | null {
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  if (lines.length === 0) return null;

  const { lastTokenUsage, modelContextWindow, model } = scanCodexUsage(lines);
  if (!lastTokenUsage) return null;

  return buildCodexUsageInfo(lastTokenUsage, modelContextWindow, model);
}
