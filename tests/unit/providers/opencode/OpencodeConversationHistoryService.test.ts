import type { HydrationContext } from '../../../../src/core/providers/types';
import type { Conversation } from '../../../../src/core/types';
import { OpencodeConversationHistoryService } from '../../../../src/providers/opencode/history/OpencodeConversationHistoryService';
import * as Store from '../../../../src/providers/opencode/history/OpencodeHistoryStore';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 't',
    messages: [],
    providerId: 'opencode',
    sessionId: 'sess-a',
    providerState: { databasePath: '/tmp/oc.db' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Conversation;
}

const ctx: HydrationContext = { vaultPath: null, reason: 'open' };

describe('OpencodeConversationHistoryService.hydrateConversationHistoryV2', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('returns empty:no-session when conversation.sessionId is null', async () => {
    const svc = new OpencodeConversationHistoryService();
    const conv = makeConversation({ sessionId: null });
    const out = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(out.kind).toBe('empty');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'empty') expect(out.reason).toBe('no-session');
  });

  it('returns loaded with messages and a stable sourceRef on success', async () => {
    jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({
      messages: [
        { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never,
      ],
    });
    const svc = new OpencodeConversationHistoryService();
    const conv = makeConversation();
    const out = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(out.kind).toBe('loaded');
    if (out.kind === 'loaded') {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.messages.length).toBe(1);
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.sourceRef).toBe('sess-a::/tmp/oc.db');
    }
    expect(conv.messages.length).toBe(0);
  });

  it('returns error:store-unreadable when the loader reports a generic error', async () => {
    jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({
      messages: [],
      error: {
        code: 'store-unreadable',
        message: 'Could not read OpenCode session rows from SQLite.',
        detail: 'detail-debug-only',
      },
    });
    const svc = new OpencodeConversationHistoryService();
    const conv = makeConversation();
    const out = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.error.code).toBe('store-unreadable');
      // eslint-disable-next-line jest/no-conditional-expect
      expect(out.error.message).not.toContain('/tmp/oc.db');
    }
    expect(conv.messages.length).toBe(0);
  });

  it('returns error:sqlite-unavailable when node:sqlite cannot load', async () => {
    jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({
      messages: [],
      error: {
        code: 'sqlite-unavailable',
        message: 'OpenCode history requires node:sqlite or the sqlite3 CLI.',
      },
    });
    const svc = new OpencodeConversationHistoryService();
    const out = await svc.hydrateConversationHistoryV2(makeConversation(), ctx);
    expect(out.kind).toBe('error');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'error') expect(out.error.code).toBe('sqlite-unavailable');
  });

  it('returns empty:no-rows when the loader returns zero messages and no error', async () => {
    jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({ messages: [] });
    const svc = new OpencodeConversationHistoryService();
    const conv = makeConversation();
    const out = await svc.hydrateConversationHistoryV2(conv, ctx);
    expect(out.kind).toBe('empty');
    // eslint-disable-next-line jest/no-conditional-expect
    if (out.kind === 'empty') expect(out.reason).toBe('no-rows');
  });
});

describe('OpencodeConversationHistoryService.deleteConversationSessionV2', () => {
  it('returns no-op:provider-owned because OpenCode native history is never mutated', async () => {
    const svc = new OpencodeConversationHistoryService();
    const conv = makeConversation();
    const out = await svc.deleteConversationSessionV2(conv, ctx);
    expect(out).toEqual({ kind: 'no-op', reason: 'provider-owned' });
  });
});

describe('OpencodeConversationHistoryService.forkSupport', () => {
  it('is undefined because Opencode does not support fork', () => {
    const svc = new OpencodeConversationHistoryService();
    expect(svc.forkSupport).toBeUndefined();
  });
});
