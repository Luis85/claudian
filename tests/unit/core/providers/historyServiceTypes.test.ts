import type {
  DeleteHistoryOutcome,
  HistoryLoadError,
  HistoryLoadErrorCode,
  HistoryLoadOutcome,
  HydrationContext,
  ProviderConversationHistoryService,
  ProviderForkSupport,
} from '@/core/providers/types';
import type { ChatMessage, Conversation } from '@/core/types';

describe('history service types', () => {
  it('HydrationContext requires vaultPath and reason; signal and forceRefresh are optional', () => {
    const minimal: HydrationContext = { vaultPath: null, reason: 'open' };
    const full: HydrationContext = {
      vaultPath: '/vault',
      signal: new AbortController().signal,
      forceRefresh: true,
      reason: 'reload',
    };
    expect(minimal.reason).toBe('open');
    expect(full.forceRefresh).toBe(true);
  });

  it('HistoryLoadErrorCode includes fork-checkpoint-not-found and sqlite-unavailable', () => {
    const codes: HistoryLoadErrorCode[] = [
      'store-missing',
      'store-unreadable',
      'sqlite-unavailable',
      'parse-failed',
      'invalid-session-id',
      'fork-checkpoint-not-found',
      'cancelled',
    ];
    expect(codes).toHaveLength(7);
  });

  it('HistoryLoadOutcome narrows on kind; sourceRef present on every variant', () => {
    const messages: ChatMessage[] = [];
    const loaded: HistoryLoadOutcome = { kind: 'loaded', messages, sourceRef: 'k1' };
    const cached: HistoryLoadOutcome = { kind: 'cached', sourceRef: 'k1' };
    const empty: HistoryLoadOutcome = { kind: 'empty', reason: 'no-session', sourceRef: null };
    const err: HistoryLoadOutcome = {
      kind: 'error',
      error: { code: 'store-missing', message: 'No store' },
      sourceRef: null,
    };

    function describeOutcome(o: HistoryLoadOutcome): string {
      switch (o.kind) {
        case 'loaded': return `loaded:${o.messages.length}:${o.sourceRef}`;
        case 'cached': return `cached:${o.sourceRef}`;
        case 'empty': return `empty:${o.reason}:${o.sourceRef ?? 'null'}`;
        case 'error': return `error:${o.error.code}:${o.sourceRef ?? 'null'}`;
      }
    }
    expect(describeOutcome(loaded)).toBe('loaded:0:k1');
    expect(describeOutcome(cached)).toBe('cached:k1');
    expect(describeOutcome(empty)).toBe('empty:no-session:null');
    expect(describeOutcome(err)).toBe('error:store-missing:null');
  });

  it('DeleteHistoryOutcome narrows on kind', () => {
    const ok: DeleteHistoryOutcome = { kind: 'deleted', paths: ['/a', '/b'] };
    const noop: DeleteHistoryOutcome = { kind: 'no-op', reason: 'provider-owned' };
    const err: DeleteHistoryOutcome = {
      kind: 'error',
      error: { code: 'invalid-session-id', message: 'bad id' },
    };
    function describeDelete(o: DeleteHistoryOutcome): string {
      switch (o.kind) {
        case 'deleted': return `deleted:${o.paths.length}`;
        case 'no-op': return `no-op:${o.reason}`;
        case 'error': return `error:${o.error.code}`;
      }
    }
    expect(describeDelete(ok)).toBe('deleted:2');
    expect(describeDelete(noop)).toBe('no-op:provider-owned');
    expect(describeDelete(err)).toBe('error:invalid-session-id');
  });

  it('HistoryLoadError shape includes code, user-safe message, optional detail (no recoverable field)', () => {
    const e: HistoryLoadError = {
      code: 'parse-failed',
      message: 'Could not parse session file',
      detail: 'JSON.parse threw at offset 412',
    };
    expect(typeof e.detail).toBe('string');
    expect(Object.keys(e)).not.toContain('recoverable');
  });

  it('ProviderForkSupport shape', () => {
    const fork: ProviderForkSupport = {
      isPendingForkConversation(_c: Conversation): boolean { return false; },
      buildForkProviderState(): Record<string, unknown> { return {}; },
    };
    expect(typeof fork.isPendingForkConversation).toBe('function');
  });
});

describe('ProviderConversationHistoryService v2 surface', () => {
  it('accepts generic TPersistedState; forkSupport is optional', () => {
    type PinnedState = { databasePath: string };
    const service: ProviderConversationHistoryService<PinnedState> = {
      async hydrateConversationHistory(_c, _ctx) {
        return { kind: 'empty', reason: 'no-store', sourceRef: null };
      },
      async deleteConversationSession(_c, _ctx) {
        return { kind: 'no-op', reason: 'provider-owned' };
      },
      resolveSessionIdForConversation(_c) { return null; },
      buildPersistedProviderState(_c) { return { databasePath: '/tmp/db' }; },
    };
    expect(service.forkSupport).toBeUndefined();
    expect(typeof service.hydrateConversationHistory).toBe('function');
    expect(typeof service.deleteConversationSession).toBe('function');
  });
});
