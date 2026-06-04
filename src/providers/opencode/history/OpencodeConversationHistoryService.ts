import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
import type {
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getOpencodeState, type OpencodeProviderState } from '../types';
import { loadOpencodeSessionMessages } from './OpencodeHistoryStore';

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
}
