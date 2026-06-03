import * as fs from 'fs';

import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
import type {
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
  ProviderForkSupport,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import type { CodexProviderState } from '../types';
import { getCodexState } from '../types';
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

  /**
   * @deprecated Root v1 shim — delegates to {@link forkSupport}. Kept until Task 10 migrates
   * `TabManager` and `ConversationStore` to the `hasForkSupport(service)` type guard, after
   * which Task 13 deletes both shims and the interface's deprecated v1 fork surface.
   */
  isPendingForkConversation(conversation: Conversation): boolean {
    return this.forkSupport!.isPendingForkConversation(conversation);
  }

  /** @deprecated Root v1 shim — see {@link isPendingForkConversation}. */
  buildForkProviderState(
    sourceSessionId: string,
    resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.forkSupport!.buildForkProviderState(sourceSessionId, resumeAt, sourceProviderState);
  }

  protected computeCacheKey(conversation: Conversation): string | null {
    const state = getCodexState(conversation.providerState);
    if (state.forkSource && state.threadId) {
      return `fork::${state.threadId}`;
    }
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

  async deleteConversationSessionV2(
    _conversation: Conversation,
    _ctx: HydrationContext,
  ): Promise<DeleteHistoryOutcome> {
    // ~/.codex transcripts are provider-owned; never delete them.
    return { kind: 'no-op', reason: 'provider-owned' };
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
