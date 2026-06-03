import type { Conversation } from '../types';
import type {
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
  ProviderConversationHistoryService,
  ProviderForkSupport,
} from './types';

/**
 * Shared base for provider conversation history services.
 *
 * Centralizes:
 *   - the `Map<convId, sourceRef>` cache that every provider duplicated
 *   - the `AbortSignal` short-circuit (so SQLite reads can be cancelled on tab switch)
 *   - the `forceRefresh` bypass
 *   - cache invalidation on `empty` / `error` outcomes
 *   - concurrent-hydration dedupe (inflight map keyed by conversation id)
 *
 * The base **never** mutates `conversation.messages`. Callers (`ConversationStore`)
 * branch on the outcome and own the assignment so the loaded/error asymmetry that
 * would otherwise stale-render an error pane never exists.
 *
 * Subclasses MAY check `ctx.signal?.aborted` at iteration boundaries inside
 * `loadMessages` (Claude's multi-session walk relies on this).
 */
export abstract class BaseHistoryService<
  TPersistedState = Record<string, unknown>,
> implements ProviderConversationHistoryService<TPersistedState> {
  private hydrationCache = new Map<string, string>();
  private inflight = new Map<string, Promise<HistoryLoadOutcome>>();

  forkSupport?: ProviderForkSupport;

  protected abstract computeCacheKey(
    conversation: Conversation,
    ctx: HydrationContext,
  ): string | null;

  protected abstract loadMessages(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<HistoryLoadOutcome>;

  abstract resolveSessionIdForConversation(
    conversation: Conversation | null,
  ): string | null;

  abstract deleteConversationSessionV2(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<DeleteHistoryOutcome>;

  buildPersistedProviderState?(
    conversation: Conversation,
  ): TPersistedState | undefined;

  async hydrateConversationHistoryV2(
    conversation: Conversation,
    ctx: HydrationContext,
  ): Promise<HistoryLoadOutcome> {
    if (ctx.signal?.aborted) {
      return {
        kind: 'error',
        error: { code: 'cancelled', message: 'Hydration cancelled' },
        sourceRef: null,
      };
    }

    const key = this.computeCacheKey(conversation, ctx);
    if (
      !ctx.forceRefresh
      && key
      && this.hydrationCache.get(conversation.id) === key
      && conversation.messages.length > 0
    ) {
      return { kind: 'cached', sourceRef: key };
    }

    const inflight = this.inflight.get(conversation.id);
    if (inflight) return inflight;

    const pending = (async (): Promise<HistoryLoadOutcome> => {
      const outcome = await this.loadMessages(conversation, ctx);

      if (outcome.kind === 'loaded' && key) {
        this.hydrationCache.set(conversation.id, key);
      } else if (outcome.kind === 'empty' || outcome.kind === 'error') {
        this.hydrationCache.delete(conversation.id);
      }

      return outcome;
    })();

    this.inflight.set(conversation.id, pending);
    try {
      return await pending;
    } finally {
      this.inflight.delete(conversation.id);
    }
  }

  /** Test-only: clears the cache. Subclasses may expose this for white-box tests. */
  protected clearHydrationCache(): void {
    this.hydrationCache.clear();
    this.inflight.clear();
  }
}
