import { ConversationStore } from '@/app/conversations/ConversationStore';
import type { SharedAppStorage } from '@/core/bootstrap/storage';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { AppSessionStorage } from '@/core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';
import type { Conversation, SessionMetadata } from '@/core/types';

type MockSessions = jest.Mocked<AppSessionStorage>;

function createMockSessions(metadata: SessionMetadata[] = []): MockSessions {
  return {
    listMetadata: jest.fn().mockResolvedValue(metadata),
    saveMetadata: jest.fn().mockResolvedValue(undefined),
    deleteMetadata: jest.fn().mockResolvedValue(undefined),
    // toSessionMetadata mirrors the real storage closely enough for the store
    // to round-trip a conversation through metadata save.
    toSessionMetadata: jest.fn((conv: Conversation) => ({
      type: 'meta',
      id: conv.id,
      providerId: conv.providerId,
      title: conv.title,
      titleGenerationStatus: conv.titleGenerationStatus,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      lastResponseAt: conv.lastResponseAt,
      sessionId: conv.sessionId,
      providerState: conv.providerState,
    }) as unknown as SessionMetadata),
  };
}

function createStore(options?: {
  sessions?: MockSessions;
  vaultPath?: string | null;
  repairViewsAfterDelete?: (conversationId: string) => Promise<void>;
}): { store: ConversationStore; sessions: MockSessions } {
  const sessions = options?.sessions ?? createMockSessions();
  const storage = { sessions } as unknown as SharedAppStorage;
  const store = new ConversationStore({
    storage,
    getVaultPath: () => (options?.vaultPath !== undefined ? options.vaultPath : '/vault'),
    repairViewsAfterDelete:
      options?.repairViewsAfterDelete ?? (async () => undefined),
    events: { emit: jest.fn(), on: jest.fn(), off: jest.fn(), setErrorSink: jest.fn() } as any,
  });
  return { store, sessions };
}

describe('ConversationStore', () => {
  beforeEach(() => {
    jest
      .spyOn(ProviderRegistry, 'getConversationHistoryService')
      .mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue(undefined),
        deleteConversationSession: jest.fn().mockResolvedValue(undefined),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        isPendingForkConversation: jest.fn().mockReturnValue(false),
        buildForkProviderState: jest.fn(),
      } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createConversation', () => {
    it('creates a conversation with a generated id and persists metadata', async () => {
      const { store, sessions } = createStore();

      const conv = await store.createConversation();

      expect(conv.id).toMatch(/^conv-\d+-[a-z0-9]+$/);
      expect(conv.providerId).toBe(DEFAULT_CHAT_PROVIDER_ID);
      expect(conv.messages).toEqual([]);
      expect(conv.sessionId).toBeNull();
      expect(sessions.saveMetadata).toHaveBeenCalledTimes(1);
      expect(store.getConversationSync(conv.id)).toBe(conv);
    });

    it('uses the provided sessionId as the conversation id when given', async () => {
      const { store } = createStore();

      const conv = await store.createConversation({ sessionId: 'sess-123' });

      expect(conv.id).toBe('sess-123');
      expect(conv.sessionId).toBe('sess-123');
    });

    it('inserts new conversations at the front of the list', async () => {
      const { store } = createStore();

      const first = await store.createConversation();
      const second = await store.createConversation();

      expect(store.getConversationList().map((c) => c.id)).toEqual([
        second.id,
        first.id,
      ]);
    });
  });

  describe('switchConversation', () => {
    it('returns null for a missing conversation', async () => {
      const { store } = createStore();
      expect(await store.switchConversation('nope')).toBeNull();
    });

    it('hydrates history for an existing conversation', async () => {
      const { store } = createStore();
      const conv = await store.createConversation();
      const history = ProviderRegistry.getConversationHistoryService(conv.providerId);

      const result = await store.switchConversation(conv.id);

      expect(result?.id).toBe(conv.id);
      expect(history.hydrateConversationHistory).toHaveBeenCalledWith(conv, '/vault');
    });
  });

  describe('updateConversation', () => {
    it('never mutates providerId', async () => {
      const { store } = createStore();
      const conv = await store.createConversation({ providerId: 'claude' });

      await store.updateConversation(conv.id, {
        providerId: 'codex',
        title: 'Renamed',
      } as Partial<Conversation>);

      const updated = store.getConversationSync(conv.id);
      expect(updated?.providerId).toBe('claude');
      expect(updated?.title).toBe('Renamed');
    });

    it('passes opaque providerState through without inspecting fields', async () => {
      const { store } = createStore();
      const conv = await store.createConversation();
      const opaque = { providerSessionId: 'x', previousProviderSessionIds: ['a'] };

      await store.updateConversation(conv.id, { providerState: opaque });

      expect(store.getConversationSync(conv.id)?.providerState).toEqual(opaque);
    });

    it('clears in-memory image data after save, but keeps it for a pending fork', async () => {
      const { store } = createStore();

      // Non-fork: image data is cleared after the metadata save (SDK owns it).
      const conv = await store.createConversation();
      conv.messages.push({
        role: 'user',
        content: 'see image',
        timestamp: Date.now(),
        images: [{ data: 'base64-bytes', mimeType: 'image/png' }],
      } as never);
      await store.updateConversation(conv.id, { title: 'with image' });
      expect(conv.messages[0].images?.[0].data).toBe('');

      // Pending fork: deep-cloned images aren't in SDK storage yet → keep them.
      jest
        .spyOn(ProviderRegistry, 'getConversationHistoryService')
        .mockReturnValue({
          hydrateConversationHistory: jest.fn().mockResolvedValue(undefined),
          deleteConversationSession: jest.fn().mockResolvedValue(undefined),
          resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
          isPendingForkConversation: jest.fn().mockReturnValue(true),
        } as never);
      const fork = await store.createConversation();
      fork.messages.push({
        role: 'user',
        content: 'fork image',
        timestamp: Date.now(),
        images: [{ data: 'fork-bytes', mimeType: 'image/png' }],
      } as never);
      await store.updateConversation(fork.id, { title: 'fork' });
      expect(fork.messages[0].images?.[0].data).toBe('fork-bytes');
    });
  });

  describe('renameConversation', () => {
    it('falls back to a default title when given blank input', async () => {
      const { store } = createStore();
      const conv = await store.createConversation();

      await store.renameConversation(conv.id, '   ');

      expect(store.getConversationSync(conv.id)?.title.trim().length).toBeGreaterThan(0);
    });
  });

  describe('deleteConversation', () => {
    it('removes the conversation, deletes provider session + metadata, and repairs views', async () => {
      const repairViewsAfterDelete = jest.fn().mockResolvedValue(undefined);
      const { store, sessions } = createStore({ repairViewsAfterDelete });
      const conv = await store.createConversation();
      const history = ProviderRegistry.getConversationHistoryService(conv.providerId);

      await store.deleteConversation(conv.id);

      expect(store.getConversationSync(conv.id)).toBeNull();
      expect(history.deleteConversationSession).toHaveBeenCalledWith(conv, '/vault');
      expect(sessions.deleteMetadata).toHaveBeenCalledWith(conv.id);
      expect(repairViewsAfterDelete).toHaveBeenCalledWith(conv.id);
    });

    it('does nothing for an unknown id', async () => {
      const repairViewsAfterDelete = jest.fn();
      const { store, sessions } = createStore({ repairViewsAfterDelete });

      await store.deleteConversation('missing');

      expect(sessions.deleteMetadata).not.toHaveBeenCalled();
      expect(repairViewsAfterDelete).not.toHaveBeenCalled();
    });
  });

  describe('getConversationById', () => {
    it('hydrates history before returning the conversation', async () => {
      const { store } = createStore();
      const conv = await store.createConversation();
      const history = ProviderRegistry.getConversationHistoryService(conv.providerId);

      const fetched = await store.getConversationById(conv.id);

      expect(fetched?.id).toBe(conv.id);
      expect(history.hydrateConversationHistory).toHaveBeenCalled();
    });
  });

  describe('getConversationList', () => {
    it('derives preview from the first user message', async () => {
      const { store } = createStore();
      const conv = await store.createConversation();
      await store.updateConversation(conv.id, {
        messages: [
          { id: 'm1', role: 'user', content: 'Hello Claude', timestamp: 1 },
        ],
      });

      const meta = store.getConversationList().find((c) => c.id === conv.id);
      expect(meta?.preview).toContain('Hello Claude');
      expect(meta?.messageCount).toBe(1);
    });
  });

  describe('loadConversations', () => {
    it('maps metadata to conversations sorted by recency and backfills response timestamps', async () => {
      const sessions = createMockSessions([
        {
          type: 'meta',
          id: 'old',
          title: 'Old',
          createdAt: 1,
          updatedAt: 10,
        } as unknown as SessionMetadata,
        {
          type: 'meta',
          id: 'new',
          title: 'New',
          createdAt: 2,
          updatedAt: 20,
        } as unknown as SessionMetadata,
      ]);
      const { store } = createStore({ sessions });

      const backfilled = await store.loadConversations();

      expect(store.getConversationList().map((c) => c.id)).toEqual(['new', 'old']);
      // No messages → nothing to backfill.
      expect(backfilled).toEqual([]);
    });

    it('defaults missing providerId to the default chat provider', async () => {
      const sessions = createMockSessions([
        { type: 'meta', id: 'a', title: 'A', createdAt: 1, updatedAt: 1 } as unknown as SessionMetadata,
      ]);
      const { store } = createStore({ sessions });

      await store.loadConversations();

      expect(store.getConversationSync('a')?.providerId).toBe(DEFAULT_CHAT_PROVIDER_ID);
    });
  });

  describe('findEmptyConversation', () => {
    it('returns the first conversation with no messages', async () => {
      const { store } = createStore();
      const conv = await store.createConversation();
      await store.updateConversation(conv.id, {
        messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
      });
      const empty = await store.createConversation();

      expect(store.findEmptyConversation()?.id).toBe(empty.id);
    });
  });

  it('exposes the live conversation list for environment reconciliation', async () => {
    const { store } = createStore();
    const conv = await store.createConversation();
    expect(store.getConversations()).toContain(conv);
  });
});
