import type { SharedAppStorage } from '../../core/bootstrap/storage';
import type { EventBus } from '../../core/events/EventBus';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../core/providers/types';
import type { Conversation, ConversationMeta } from '../../core/types';
import type { ClaudianEventMap } from '../events/claudianEvents';

/**
 * Collaborators the store needs from the Obsidian-lifecycle plugin shell.
 *
 * The store owns the in-memory conversation list and all session-metadata,
 * transcript-hydration, and deletion coordination. It reaches the host only
 * for the live vault path and to repair open views after a delete — both kept
 * as narrow callbacks so the store stays free of `features/` and Obsidian
 * dependencies.
 */
export interface ConversationStoreDeps {
  storage: SharedAppStorage;
  getVaultPath(): string | null;
  /**
   * Repairs open chat tabs bound to a just-deleted conversation. The shell
   * cancels any active stream and resets the tab to a fresh conversation,
   * preserving the prior in-shell delete behavior.
   */
  repairViewsAfterDelete(conversationId: string): Promise<void>;
  /**
   * App-level event bus. The store stays narrow — it only emits
   * `conversation:renamed` so far, but the bus reference is plumbed at the
   * dependency boundary so future store-owned events (delete notifications,
   * provider switches) don't need a constructor change.
   */
  events: EventBus<ClaudianEventMap>;
}

/**
 * Owns live conversation state: the in-memory list, session-metadata mapping,
 * provider transcript hydration, deletion coordination, conversation preview,
 * title-status persistence, and provider-state persistence handoff.
 *
 * `Conversation.providerState` is treated as opaque here. Provider-specific
 * fields are only ever passed through `ProviderConversationHistoryService`
 * (resolved via `ProviderRegistry`); the store never inspects them.
 */
export class ConversationStore {
  private conversations: Conversation[] = [];

  constructor(private readonly deps: ConversationStoreDeps) {}

  /**
   * Builds the in-memory list from persisted session metadata, sorts by
   * recency, and backfills missing response timestamps. Returns the
   * conversations that gained a backfilled `lastResponseAt` so the caller can
   * persist them alongside any other load-time invalidations.
   */
  async loadConversations(): Promise<Conversation[]> {
    const allMetadata = await this.deps.storage.sessions.listMetadata();
    this.conversations = allMetadata
      .map((meta) => {
        const resumeSessionId = meta.sessionId !== undefined ? meta.sessionId : meta.id;

        return {
          id: meta.id,
          providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
          title: meta.title,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastResponseAt: meta.lastResponseAt,
          sessionId: resumeSessionId,
          providerState: meta.providerState,
          messages: [],
          currentNote: meta.currentNote,
          externalContextPaths: meta.externalContextPaths,
          enabledMcpServers: meta.enabledMcpServers,
          usage: meta.usage,
          titleGenerationStatus: meta.titleGenerationStatus,
          resumeAtMessageId: meta.resumeAtMessageId,
        } satisfies Conversation;
      })
      .sort((a, b) => (b.lastResponseAt ?? b.updatedAt) - (a.lastResponseAt ?? a.updatedAt));

    return this.backfillConversationResponseTimestamps();
  }

  private backfillConversationResponseTimestamps(): Conversation[] {
    const updated: Conversation[] = [];
    for (const conv of this.conversations) {
      if (conv.lastResponseAt != null) continue;
      if (!conv.messages || conv.messages.length === 0) continue;

      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (msg.role === 'assistant') {
          conv.lastResponseAt = msg.timestamp;
          updated.push(conv);
          break;
        }
      }
    }
    return updated;
  }

  /** Live conversation list, used by environment reconciliation at the shell. */
  getConversations(): Conversation[] {
    return this.conversations;
  }

  async createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    orchestratorMode?: boolean;
  }): Promise<Conversation> {
    const providerId = options?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    const sessionId = options?.sessionId;
    const conversationId = sessionId ?? this.generateConversationId();
    const conversation: Conversation = {
      id: conversationId,
      providerId,
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: sessionId ?? null,
      messages: [],
      ...(options?.orchestratorMode ? { orchestratorMode: true } : {}),
    };

    this.conversations.unshift(conversation);
    await this.deps.storage.sessions.saveMetadata(
      this.deps.storage.sessions.toSessionMetadata(conversation),
    );

    return conversation;
  }

  async switchConversation(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find((c) => c.id === id);
    if (!conversation) return null;

    await this.loadSdkMessagesForConversation(conversation);

    return conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    const index = this.conversations.findIndex((c) => c.id === id);
    if (index === -1) return;

    const conversation = this.conversations[index];
    this.conversations.splice(index, 1);

    await ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .deleteConversationSession(conversation, this.deps.getVaultPath());

    await this.deps.storage.sessions.deleteMetadata(id);

    await this.deps.repairViewsAfterDelete(id);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const conversation = this.conversations.find((c) => c.id === id);
    if (!conversation) return;

    const previousTitle = conversation.title;
    const nextTitle = title.trim() || this.generateDefaultTitle();
    conversation.title = nextTitle;
    conversation.updatedAt = Date.now();

    await this.deps.storage.sessions.saveMetadata(
      this.deps.storage.sessions.toSessionMetadata(conversation),
    );

    if (nextTitle !== previousTitle) {
      this.deps.events.emit('conversation:renamed', {
        conversationId: id,
        title: nextTitle,
      });
    }
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.conversations.find((c) => c.id === id);
    if (!conversation) return;

    // providerId is immutable — strip it from updates to prevent accidental mutation
    const safeUpdates = { ...updates };
    delete safeUpdates.providerId;
    const previousTitle = conversation.title;
    Object.assign(conversation, safeUpdates, { updatedAt: Date.now() });

    await this.deps.storage.sessions.saveMetadata(
      this.deps.storage.sessions.toSessionMetadata(conversation),
    );

    if (conversation.title !== previousTitle) {
      this.deps.events.emit('conversation:renamed', {
        conversationId: id,
        title: conversation.title,
      });
    }

    // Clear image data from memory after save (data is persisted by SDK).
    // Skip for pending forks: their deep-cloned images aren't in SDK storage yet.
    // v1 fork hook is optional on the interface (will move to `forkSupport` in Task 13);
    // absent means "no fork concept", treat as non-pending.
    const historyService = ProviderRegistry.getConversationHistoryService(conversation.providerId);
    const isPendingFork = historyService.isPendingForkConversation?.(conversation) ?? false;
    if (!isPendingFork) {
      for (const msg of conversation.messages) {
        if (msg.images) {
          for (const img of msg.images) {
            img.data = '';
          }
        }
      }
    }
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find((c) => c.id === id) || null;

    if (conversation) {
      await this.loadSdkMessagesForConversation(conversation);
    }

    return conversation;
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversations.find((c) => c.id === id) || null;
  }

  findEmptyConversation(): Conversation | null {
    return this.conversations.find((c) => c.messages.length === 0) || null;
  }

  getConversationList(): ConversationMeta[] {
    return this.conversations.map((c) => ({
      id: c.id,
      providerId: c.providerId,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastResponseAt: c.lastResponseAt,
      messageCount: c.messages.length,
      preview: this.getConversationPreview(c),
      titleGenerationStatus: c.titleGenerationStatus,
    }));
  }

  private async loadSdkMessagesForConversation(conversation: Conversation): Promise<void> {
    await ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .hydrateConversationHistory(conversation, this.deps.getVaultPath());
  }

  private getConversationPreview(conv: Conversation): string {
    const firstUserMsg = conv.messages.find((m) => m.role === 'user');
    if (!firstUserMsg) {
      return 'New conversation';
    }
    return firstUserMsg.content.substring(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
  }

  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDefaultTitle(): string {
    const now = new Date();
    return now.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
