import { ConversationStore } from '@/app/conversations/ConversationStore';
import type { SharedAppStorage } from '@/core/bootstrap/storage';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type {
  AppSessionStorage,
  DeleteHistoryOutcome,
  HistoryLoadOutcome,
  HydrationContext,
} from '@/core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';
import type { ChatMessage, Conversation, SessionMetadata } from '@/core/types';

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
      boundAgentId: conv.boundAgentId,
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
        hydrateConversationHistory: jest
          .fn()
          .mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: jest
          .fn()
          .mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        forkSupport: {
          isPendingForkConversation: jest.fn().mockReturnValue(false),
          buildForkProviderState: jest.fn(),
        },
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

    it('persists boundAgentId when provided', async () => {
      const { store, sessions } = createStore();

      const conv = await store.createConversation({ boundAgentId: 'roster:researcher' });

      expect(conv.boundAgentId).toBe('roster:researcher');
      // metadata must carry the field so it survives reload
      const savedMeta = sessions.saveMetadata.mock.calls[0][0];
      expect(savedMeta).toMatchObject({ boundAgentId: 'roster:researcher' });
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
      expect(history.hydrateConversationHistory).toHaveBeenCalledWith(conv, {
        vaultPath: '/vault',
        reason: 'open',
      });
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
          hydrateConversationHistory: jest
            .fn()
            .mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
          deleteConversationSession: jest
            .fn()
            .mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
          resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
          forkSupport: {
            isPendingForkConversation: jest.fn().mockReturnValue(true),
            buildForkProviderState: jest.fn(),
          },
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

    it('preserves image.path while clearing image.data after save', async () => {
      const { store } = createStore();
      const conv = await store.createConversation();
      conv.messages.push({
        role: 'user',
        content: 'see image',
        timestamp: Date.now(),
        images: [
          { id: 'a', name: 'a.png', data: 'AAA=', path: 'attachments/a.png', mediaType: 'image/png', size: 1, source: 'paste' },
          { id: 'b', name: 'b.png', data: 'BBB=', path: 'attachments/b.png', mediaType: 'image/png', size: 1, source: 'paste' },
        ],
      } as never);
      await store.updateConversation(conv.id, { title: 'with images' });

      for (const msg of conv.messages) {
        for (const img of msg.images ?? []) {
          expect(img.data).toBe('');
          expect(img.path).toMatch(/^attachments\//);
        }
      }
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
      expect(history.deleteConversationSession).toHaveBeenCalledWith(conv, {
        vaultPath: '/vault',
        reason: 'open',
      });
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

    it('loads boundAgentId from metadata on loadConversations', async () => {
      const meta = {
        id: 'conv-1',
        providerId: 'claude' as const,
        title: 'Test',
        createdAt: 1000,
        updatedAt: 1000,
        sessionId: null,
        boundAgentId: 'roster:researcher',
      } as any;
      const { store } = createStore({ sessions: createMockSessions([meta]) });

      await store.loadConversations();

      expect(store.getConversationSync('conv-1')?.boundAgentId).toBe('roster:researcher');
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

  describe('caller branches on HistoryLoadOutcome (v2)', () => {
    const makeMsg = (): ChatMessage =>
      ({ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }) as ChatMessage;
    const SEEDED: ChatMessage = {
      id: 'pre',
      role: 'user',
      content: 'pre-existing',
      timestamp: 0,
    } as ChatMessage;

    type StoreHarness = {
      store: ConversationStore;
      emit: jest.Mock;
    };

    function makeHarnessWithHydrateOutcome(
      outcome: HistoryLoadOutcome,
    ): StoreHarness {
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue(outcome),
        deleteConversationSession: jest
          .fn()
          .mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
      });
      const emit = jest.fn();
      const sessions = createMockSessions();
      const storage = { sessions } as unknown as SharedAppStorage;
      const store = new ConversationStore({
        storage,
        getVaultPath: () => '/vault',
        repairViewsAfterDelete: async () => undefined,
        events: { emit, on: jest.fn(), off: jest.fn(), setErrorSink: jest.fn() } as any,
      });
      return { store, emit };
    }

    it("assigns messages on 'loaded' and does not emit", async () => {
      const loaded: HistoryLoadOutcome = {
        kind: 'loaded',
        messages: [makeMsg()],
        sourceRef: 'k',
      };
      const { store, emit } = makeHarnessWithHydrateOutcome(loaded);
      const conv = await store.createConversation();
      conv.messages.push(SEEDED);

      const result = await store.switchConversation(conv.id);

      expect(result?.id).toBe(conv.id);
      expect(conv.messages).toEqual(loaded.messages);
      expect(emit).not.toHaveBeenCalledWith(
        'conversation:hydration-failed',
        expect.anything(),
      );
    });

    it("leaves messages alone on 'cached' and does not emit", async () => {
      const { store, emit } = makeHarnessWithHydrateOutcome({
        kind: 'cached',
        sourceRef: 'k',
      });
      const conv = await store.createConversation();
      conv.messages.push(SEEDED);

      const result = await store.switchConversation(conv.id);

      expect(result?.id).toBe(conv.id);
      expect(conv.messages).toEqual([SEEDED]);
      expect(emit).not.toHaveBeenCalledWith(
        'conversation:hydration-failed',
        expect.anything(),
      );
    });

    it("leaves messages alone on 'empty' and does not emit", async () => {
      const { store, emit } = makeHarnessWithHydrateOutcome({
        kind: 'empty',
        reason: 'no-rows',
        sourceRef: 'k',
      });
      const conv = await store.createConversation();
      conv.messages.push(SEEDED);

      const result = await store.switchConversation(conv.id);

      expect(result?.id).toBe(conv.id);
      expect(conv.messages).toEqual([SEEDED]);
      expect(emit).not.toHaveBeenCalledWith(
        'conversation:hydration-failed',
        expect.anything(),
      );
    });

    it("emits 'conversation:hydration-failed' on 'error' and leaves messages alone", async () => {
      const { store, emit } = makeHarnessWithHydrateOutcome({
        kind: 'error',
        error: { code: 'store-unreadable', message: 'x' },
        sourceRef: null,
      });
      const conv = await store.createConversation();
      conv.messages.push(SEEDED);

      const result = await store.switchConversation(conv.id);

      expect(result?.id).toBe(conv.id);
      expect(conv.messages).toEqual([SEEDED]);
      expect(emit).toHaveBeenCalledWith('conversation:hydration-failed', {
        conversationId: conv.id,
        code: 'store-unreadable',
        message: 'x',
      });
    });

    it('passes HydrationContext with vaultPath and reason to v2', async () => {
      const hydrateMock = jest.fn().mockResolvedValue({ kind: 'cached', sourceRef: 'k' });
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: hydrateMock,
        deleteConversationSession: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
      });

      const { store } = createStore();
      const conv = await store.createConversation();
      await store.switchConversation(conv.id);

      expect(hydrateMock).toHaveBeenCalledTimes(1);
      const [convArg, ctxArg] = hydrateMock.mock.calls[0] as [Conversation, HydrationContext];
      expect(convArg).toBe(conv);
      expect(ctxArg.vaultPath).toBe('/vault');
      expect(ctxArg.reason).toBe('open');
    });
  });

  describe('deleteConversation branches on DeleteHistoryOutcome (v2)', () => {
    type DeleteHarness = {
      store: ConversationStore;
      sessions: MockSessions;
      emit: jest.Mock;
      deleteMock: jest.Mock;
      repairViewsAfterDelete: jest.Mock;
    };

    function makeHarnessWithDeleteOutcome(
      outcome: DeleteHistoryOutcome,
    ): DeleteHarness {
      const deleteMock = jest.fn().mockResolvedValue(outcome);
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest
          .fn()
          .mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: deleteMock,
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
      });
      const emit = jest.fn();
      const sessions = createMockSessions();
      const storage = { sessions } as unknown as SharedAppStorage;
      const repairViewsAfterDelete = jest.fn().mockResolvedValue(undefined);
      const store = new ConversationStore({
        storage,
        getVaultPath: () => '/vault',
        repairViewsAfterDelete,
        events: { emit, on: jest.fn(), off: jest.fn(), setErrorSink: jest.fn() } as any,
      });
      return { store, sessions, emit, deleteMock, repairViewsAfterDelete };
    }

    it("passes HydrationContext to v2 and cleans up on 'deleted' without emitting", async () => {
      const harness = makeHarnessWithDeleteOutcome({
        kind: 'deleted',
        paths: ['/tmp/x.jsonl'],
      });
      const conv = await harness.store.createConversation();

      await harness.store.deleteConversation(conv.id);

      expect(harness.deleteMock).toHaveBeenCalledTimes(1);
      const [, ctxArg] = harness.deleteMock.mock.calls[0] as [Conversation, HydrationContext];
      expect(ctxArg.vaultPath).toBe('/vault');
      expect(ctxArg.reason).toBe('open');
      expect(harness.sessions.deleteMetadata).toHaveBeenCalledWith(conv.id);
      expect(harness.repairViewsAfterDelete).toHaveBeenCalledWith(conv.id);
      expect(harness.emit).not.toHaveBeenCalledWith(
        'conversation:hydration-failed',
        expect.anything(),
      );
    });

    it("cleans up on 'no-op' without emitting", async () => {
      const harness = makeHarnessWithDeleteOutcome({
        kind: 'no-op',
        reason: 'no-session',
      });
      const conv = await harness.store.createConversation();

      await harness.store.deleteConversation(conv.id);

      expect(harness.sessions.deleteMetadata).toHaveBeenCalledWith(conv.id);
      expect(harness.repairViewsAfterDelete).toHaveBeenCalledWith(conv.id);
      expect(harness.emit).not.toHaveBeenCalledWith(
        'conversation:hydration-failed',
        expect.anything(),
      );
    });

    it("emits 'conversation:hydration-failed' on 'error' and still cleans up metadata", async () => {
      const harness = makeHarnessWithDeleteOutcome({
        kind: 'error',
        error: { code: 'store-unreadable', message: 'boom' },
      });
      const conv = await harness.store.createConversation();

      await harness.store.deleteConversation(conv.id);

      expect(harness.emit).toHaveBeenCalledWith('conversation:hydration-failed', {
        conversationId: conv.id,
        code: 'store-unreadable',
        message: 'boom',
      });
      expect(harness.sessions.deleteMetadata).toHaveBeenCalledWith(conv.id);
      expect(harness.repairViewsAfterDelete).toHaveBeenCalledWith(conv.id);
    });
  });

  describe('history-backed usage recovery', () => {
    it('calls extractLastUsage when conversation.usage is unset and populates it', async () => {
      const recovered = {
        model: 'claude-sonnet-4',
        inputTokens: 100,
        contextTokens: 100,
        contextWindow: 200_000,
        percentage: 0,
      };
      const extractLastUsage = jest.fn().mockResolvedValue(recovered);
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        extractLastUsage,
      } as never);

      const { store } = createStore();
      const conv = await store.createConversation();
      expect(conv.usage).toBeUndefined();

      await store.switchConversation(conv.id);

      expect(extractLastUsage).toHaveBeenCalledWith(conv, {
        vaultPath: '/vault',
        reason: 'open',
      });
      expect(conv.usage).toBe(recovered);
    });

    it('skips extractLastUsage when conversation.usage is already set', async () => {
      const extractLastUsage = jest.fn();
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        extractLastUsage,
      } as never);

      const { store } = createStore();
      const conv = await store.createConversation();
      const existing = {
        model: 'claude-sonnet-4',
        inputTokens: 50,
        contextTokens: 50,
        contextWindow: 200_000,
        percentage: 0,
      };
      conv.usage = existing;

      await store.switchConversation(conv.id);

      expect(extractLastUsage).not.toHaveBeenCalled();
      expect(conv.usage).toBe(existing);
    });

    it('tolerates extractLastUsage throwing without breaking hydration', async () => {
      const extractLastUsage = jest.fn().mockRejectedValue(new Error('boom'));
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        extractLastUsage,
      } as never);

      const { store } = createStore();
      const conv = await store.createConversation();

      // Should not throw despite the recovery hook rejecting.
      const result = await store.switchConversation(conv.id);
      expect(result?.id).toBe(conv.id);
      expect(conv.usage).toBeUndefined();
    });

    it('treats null return as "no historical usage" without overwriting', async () => {
      const extractLastUsage = jest.fn().mockResolvedValue(null);
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        extractLastUsage,
      } as never);

      const { store } = createStore();
      const conv = await store.createConversation();

      await store.switchConversation(conv.id);

      expect(extractLastUsage).toHaveBeenCalled();
      expect(conv.usage).toBeUndefined();
    });

    it('does not require extractLastUsage on the service', async () => {
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        // extractLastUsage intentionally absent.
      });

      const { store } = createStore();
      const conv = await store.createConversation();

      const result = await store.switchConversation(conv.id);
      expect(result?.id).toBe(conv.id);
      expect(conv.usage).toBeUndefined();
    });
  });

  describe('updateConversation routes fork detection via hasForkSupport', () => {
    it('clears images when service has no forkSupport slot', async () => {
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        // forkSupport intentionally absent.
      });

      const { store } = createStore();
      const conv = await store.createConversation();
      conv.messages.push({
        role: 'user',
        content: 'see image',
        timestamp: Date.now(),
        images: [{ data: 'base64-bytes', mimeType: 'image/png' }],
      } as never);

      await store.updateConversation(conv.id, { title: 'with image' });

      expect(conv.messages[0].images?.[0].data).toBe('');
    });

    it('preserves images for a pending fork via forkSupport.isPendingForkConversation', async () => {
      const isPendingForkConversation = jest.fn().mockReturnValue(true);
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistory: jest.fn().mockResolvedValue({ kind: 'cached', sourceRef: 'k' }),
        deleteConversationSession: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: jest.fn().mockReturnValue(null),
        forkSupport: {
          isPendingForkConversation,
          buildForkProviderState: jest.fn(),
        },
      } as never);

      const { store } = createStore();
      const fork = await store.createConversation();
      fork.messages.push({
        role: 'user',
        content: 'fork image',
        timestamp: Date.now(),
        images: [{ data: 'fork-bytes', mimeType: 'image/png' }],
      } as never);

      await store.updateConversation(fork.id, { title: 'fork' });

      expect(isPendingForkConversation).toHaveBeenCalledWith(fork);
      expect(fork.messages[0].images?.[0].data).toBe('fork-bytes');
    });
  });
});
