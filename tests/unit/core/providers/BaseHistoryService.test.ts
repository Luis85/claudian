import { BaseHistoryService } from '@/core/providers/BaseHistoryService';
import type {
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
} from '@/core/providers/types';
import type { ChatMessage, Conversation } from '@/core/types';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Test',
    messages: [],
    providerId: 'claude',
    sessionId: null,
    providerState: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Conversation;
}

class FakeHistoryService extends BaseHistoryService {
  loadCalls = 0;
  nextOutcome: HistoryLoadOutcome = { kind: 'empty', reason: 'no-session', sourceRef: null };
  loadDelayMs = 0;

  protected computeCacheKey(c: Conversation): string | null {
    return c.sessionId ? `${c.id}:${c.sessionId}` : null;
  }

  protected async loadMessages(): Promise<HistoryLoadOutcome> {
    this.loadCalls++;
    if (this.loadDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.loadDelayMs));
    }
    return this.nextOutcome;
  }

  resolveSessionIdForConversation(c: Conversation | null): string | null {
    return c?.sessionId ?? null;
  }

  async deleteConversationSessionV2(): Promise<DeleteHistoryOutcome> {
    return { kind: 'no-op', reason: 'no-session' };
  }
}

const ctx: HydrationContext = { vaultPath: '/vault', reason: 'open' };

describe('BaseHistoryService.hydrateConversationHistoryV2', () => {
  it('returns loaded WITHOUT mutating conversation.messages (caller is responsible)', async () => {
    const svc = new FakeHistoryService();
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
    ];
    svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };

    const conv = makeConversation({ sessionId: 'sess-a' });
    const outcome = await svc.hydrateConversationHistoryV2(conv, ctx);

    expect(outcome.kind).toBe('loaded');
    expect(conv.messages).toEqual([]);
  });

  it('short-circuits as cached when key matches and sourceRef tracked by the cache', async () => {
    const svc = new FakeHistoryService();
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
    ];
    svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };

    const conv = makeConversation({ sessionId: 'sess-a' });
    const first = await svc.hydrateConversationHistoryV2(conv, ctx);
    if (first.kind === 'loaded') conv.messages = first.messages;
    expect(svc.loadCalls).toBe(1);

    const second = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(second).toEqual({ kind: 'cached', sourceRef: 'conv-1:sess-a' });
    expect(svc.loadCalls).toBe(1);
  });

  it('forceRefresh bypasses the cache short-circuit', async () => {
    const svc = new FakeHistoryService();
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
    ];
    svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };

    const conv = makeConversation({ sessionId: 'sess-a' });
    const first = await svc.hydrateConversationHistoryV2(conv, ctx);
    if (first.kind === 'loaded') conv.messages = first.messages;
    await svc.hydrateConversationHistoryV2(conv, { ...ctx, forceRefresh: true });

    expect(svc.loadCalls).toBe(2);
  });

  it('returns cancelled error when the signal is already aborted', async () => {
    const svc = new FakeHistoryService();
    const controller = new AbortController();
    controller.abort();

    const conv = makeConversation({ sessionId: 'sess-a' });
    const outcome = await svc.hydrateConversationHistoryV2(conv, {
      ...ctx,
      signal: controller.signal,
    });

    expect(outcome.kind).toBe('error');
    // eslint-disable-next-line jest/no-conditional-expect
    if (outcome.kind === 'error') expect(outcome.error.code).toBe('cancelled');
    expect(svc.loadCalls).toBe(0);
  });

  it('clears the cache entry on empty outcome', async () => {
    const svc = new FakeHistoryService();
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
    ];
    svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };

    const conv = makeConversation({ sessionId: 'sess-a' });
    const first = await svc.hydrateConversationHistoryV2(conv, ctx);
    if (first.kind === 'loaded') conv.messages = first.messages;

    svc.nextOutcome = { kind: 'empty', reason: 'no-rows', sourceRef: 'conv-1:sess-a' };
    conv.messages = [];
    const outcome = await svc.hydrateConversationHistoryV2(conv, { ...ctx, forceRefresh: true });

    expect(outcome.kind).toBe('empty');
    svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };
    await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(svc.loadCalls).toBe(3);
  });

  it('clears the cache entry on error outcome and never overwrites conversation.messages', async () => {
    const svc = new FakeHistoryService();
    svc.nextOutcome = {
      kind: 'error',
      error: { code: 'store-unreadable', message: 'broken' },
      sourceRef: null,
    };

    const conv = makeConversation({ sessionId: 'sess-a' });
    conv.messages = [
      { id: 'pre', role: 'user', content: 'pre', timestamp: 1 } as ChatMessage,
    ];
    const outcome = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(outcome.kind).toBe('error');
    expect(conv.messages.length).toBe(1);
  });

  it('does not short-circuit when computeCacheKey returns null', async () => {
    const svc = new FakeHistoryService();
    svc.nextOutcome = { kind: 'empty', reason: 'no-session', sourceRef: null };

    const conv = makeConversation({ sessionId: null });
    await svc.hydrateConversationHistoryV2(conv, ctx);
    await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(svc.loadCalls).toBe(2);
  });

  it('seeds the cache when loadMessages resolves a source unknown at key-compute time', async () => {
    // Mirrors Codex: computeCacheKey is null for a threadId-only conversation
    // until loadMessages discovers and backfills the session path, after which
    // the key becomes concrete. The cache must seed on that resolved key so the
    // follow-up restore/createTab hydration hits the cache instead of reparsing.
    class BackfillingService extends BaseHistoryService {
      loadCalls = 0;
      protected computeCacheKey(c: Conversation): string | null {
        return c.sessionId ? `${c.id}:${c.sessionId}` : null;
      }
      protected async loadMessages(c: Conversation): Promise<HistoryLoadOutcome> {
        this.loadCalls++;
        (c as { sessionId: string | null }).sessionId = 'sess-backfilled';
        return {
          kind: 'loaded',
          messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage],
          sourceRef: `${c.id}:sess-backfilled`,
        };
      }
      resolveSessionIdForConversation(c: Conversation | null): string | null {
        return c?.sessionId ?? null;
      }
      async deleteConversationSessionV2(): Promise<DeleteHistoryOutcome> {
        return { kind: 'no-op', reason: 'no-session' };
      }
    }

    const svc = new BackfillingService();
    const conv = makeConversation({ sessionId: null });
    const first = await svc.hydrateConversationHistoryV2(conv, ctx);
    if (first.kind === 'loaded') conv.messages = first.messages;
    expect(svc.loadCalls).toBe(1);

    const second = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(second).toEqual({ kind: 'cached', sourceRef: 'conv-1:sess-backfilled' });
    expect(svc.loadCalls).toBe(1);
  });

  it('dedupes concurrent hydrations of the same conversation through inflight map', async () => {
    const svc = new FakeHistoryService();
    svc.loadDelayMs = 10;
    svc.nextOutcome = {
      kind: 'loaded',
      messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage],
      sourceRef: 'conv-1:sess-a',
    };

    const conv = makeConversation({ sessionId: 'sess-a' });
    const [a, b] = await Promise.all([
      svc.hydrateConversationHistoryV2(conv, ctx),
      svc.hydrateConversationHistoryV2(conv, ctx),
    ]);

    expect(svc.loadCalls).toBe(1);
    expect(a).toEqual(b);
  });
});
