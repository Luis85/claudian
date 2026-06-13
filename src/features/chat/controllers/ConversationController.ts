import { Menu, Notice, setIcon } from 'obsidian';

import type { TitleGenerationService } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { ChatRewindMode } from '../../../core/runtime/types';
import type { ChatMessage, Conversation, ConversationMeta } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { confirm } from '../../../shared/modals/ConfirmModal';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { ExternalContextSelector, McpServerSelector } from '../ui/InputToolbar';
import type { StatusPanel } from '../ui/StatusPanel';
import {
  resolveRewindTarget,
  rewindConfirmMessage,
  rewindSaveFailedNotice,
  rewindSuccessNotice,
  runRewind,
} from './rewindHelpers';
import {
  buildConversationUpdates,
  collectSaveSelections,
  ensureConversationForSave,
  resolveSessionUpdates,
} from './saveHelpers';

function runConversationAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

/**
 * Conversations mounted per history-dropdown chunk. Like the message-list window
 * (PERF-2), this bounds DOM nodes + per-row listeners to O(window) instead of
 * O(conversation count); older conversations mount on demand via "Show more".
 */
const HISTORY_RENDER_WINDOW_SIZE = 50;

export interface ConversationCallbacks {
  onNewConversation?: () => void;
  onConversationLoaded?: () => void;
  onConversationSwitched?: () => void;
}

export interface ConversationControllerDeps {
  plugin: ClaudianPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getHistoryDropdown: () => HTMLElement | null;
  getWelcomeEl: () => HTMLElement | null;
  setWelcomeEl: (el: HTMLElement | null) => void;
  getMessagesEl: () => HTMLElement;
  getInputEl: () => HTMLTextAreaElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => ExternalContextSelector | null;
  clearQueuedMessage: () => void;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getAgentService?: () => ChatRuntime | null;
  ensureServiceForConversation?: (conversation: Conversation | null) => Promise<void>;
  dismissPendingInlinePrompts?: () => void;
  /** Returns and clears a hydration failure recorded for the conversation while it was being opened. */
  consumePendingHydrationError?: (conversationId: string) => { code: string; message: string } | null;
  /**
   * Resolves the work-order note path linked to this tab's current conversation,
   * if any. Wired to `tab.workOrderPath` so `save()` can persist it on the
   * durable `Conversation` and let the chat-display splitter re-fire after
   * reopen/restart. Returns `null` for normal (non-work-order) tabs.
   */
  getWorkOrderPath?: () => string | null;
}

type SaveOptions = {
  resumeAtMessageId?: string;
};

export type HistoryConversationOpenState = 'closed' | 'open' | 'current';

type HistoryRenderOptions = {
  onSelectConversation: (id: string) => Promise<void>;
  onOpenConversationInNewTab?: (id: string, activate?: boolean) => Promise<void>;
  getConversationOpenState?: (id: string) => HistoryConversationOpenState;
  onRerender: () => void;
};

export class ConversationController {
  private deps: ConversationControllerDeps;
  private callbacks: ConversationCallbacks;
  /**
   * Tracks the in-flight transcript hydration so a follow-up tab switch can
   * cancel the previous load instead of letting two hydrations race for the
   * same renderer. Null when no hydration is active.
   */
  private hydrationAbort: AbortController | null = null;
  /**
   * Resolves when the active hydration's post-load restore lands (or aborts).
   * Exposed via {@link whenHydrated} for tests and integration code that need
   * to observe the post-hydrate state. Null when no hydration is in flight.
   */
  private hydrationPromise: Promise<void> | null = null;

  constructor(deps: ConversationControllerDeps, callbacks: ConversationCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  /**
   * Clears per-conversation state back to the entry point (no conversation)
   * and resets the agent service session. Passes persistent paths so stale
   * external contexts don't leak into the next conversation.
   */
  private resetToEntryPointState(): void {
    const { plugin, state } = this.deps;
    state.currentConversationId = null;
    state.clearMessages();
    state.usage = null;
    state.currentTodos = null;
    state.pendingNewSessionPlan = null;
    state.planFilePath = null;
    state.prePlanPermissionMode = null;
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
    state.hasPendingConversationSave = false;

    this.getAgentService()?.syncConversationState(
      null,
      plugin.settings.persistentExternalContextPaths || []
    );
  }

  // ============================================
  // Conversation Lifecycle
  // ============================================

  /**
   * Resets to entry point state (New Chat).
   *
   * Entry point is a blank UI state - no conversation is created until the
   * first message is sent. This prevents empty conversations cluttering history.
   */
  async createNew(options: { force?: boolean } = {}): Promise<void> {
    const { plugin, state, subagentManager } = this.deps;
    const force = !!options.force;
    if (state.isStreaming && !force) return;
    if (state.isCreatingConversation) return;
    if (state.isSwitchingConversation) return;

    // Set flag to block message sending during reset
    state.isCreatingConversation = true;

    try {
      this.deps.dismissPendingInlinePrompts?.();

      if (force && state.isStreaming) {
        state.cancelRequested = true;
        state.bumpStreamGeneration();
        this.getAgentService()?.cancel();
      }

      // Save current conversation if it has messages
      if (state.currentConversationId && state.messages.length > 0) {
        await this.save();
      }

      subagentManager.orphanAllActive();
      subagentManager.clear();

      // Clear streaming state and related DOM references
      cleanupThinkingBlock(state.currentThinkingState);
      state.currentContentEl = null;
      state.currentTextEl = null;
      state.currentTextContent = '';
      state.currentThinkingState = null;
      state.toolCallElements.clear();
      state.writeEditStates.clear();
      state.isStreaming = false;

      // Reset to entry point state - no conversation created yet
      this.resetToEntryPointState();

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.empty();

      // Recreate welcome element first (before StatusPanel for consistent ordering)
      const welcomeEl = messagesEl.createDiv({ cls: 'claudian-welcome' });
      welcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: this.getGreeting() });
      this.deps.setWelcomeEl(welcomeEl);

      // Remount StatusPanel to restore state for new conversation
      this.deps.getStatusPanel()?.remount();

      this.deps.getInputEl().value = '';

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewConversation();
      fileCtx?.autoAttachActiveFile();

      this.deps.getImageContextManager()?.clearImages();
      this.deps.getMcpServerSelector()?.clearEnabled();
      // Pass current settings to ensure we have the most up-to-date persistent paths
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
      this.deps.clearQueuedMessage();

      this.callbacks.onNewConversation?.();
    } finally {
      state.isCreatingConversation = false;
    }
  }

  /**
   * Loads the current tab conversation, or starts at entry point if none.
   *
   * Entry point (no conversation) shows welcome screen without
   * creating a conversation. Conversation is created lazily on first message.
   */
  async loadActive(): Promise<void> {
    const { plugin, state, renderer } = this.deps;

    const conversationId = state.currentConversationId;
    // Clear any stale failure banner/pending failure before hydrating; a fresh
    // failure re-arms it via the hydrate below and renders in restoreConversation.
    renderer.clearHydrationBanner();
    if (conversationId) this.deps.consumePendingHydrationError?.(conversationId);
    const conversation = conversationId ? await plugin.getConversationById(conversationId) : null;

    // No active conversation - start at entry point
    if (!conversation) {
      this.resetToEntryPointState();

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewConversation();
      fileCtx?.autoAttachActiveFile();

      // Initialize external contexts with persistent paths from settings
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );

      this.deps.getMcpServerSelector()?.clearEnabled();

      const welcomeEl = renderer.renderMessages(
        [],
        () => this.getGreeting()
      );
      this.deps.setWelcomeEl(welcomeEl);
      this.updateWelcomeVisibility();

      this.callbacks.onConversationLoaded?.();
      return;
    }

    await this.deps.ensureServiceForConversation?.(conversation);
    this.restoreConversation(conversation, { autoAttachFile: true });
    this.updateWelcomeVisibility();

    this.callbacks.onConversationLoaded?.();
  }

  /** Switches to a different conversation. */
  async switchTo(id: string): Promise<void> {
    const { state, subagentManager, renderer } = this.deps;

    if (id === state.currentConversationId) return;
    if (state.isStreaming) return;
    if (state.isSwitchingConversation) return;
    if (state.isCreatingConversation) return;

    // Cancel any prior hydration so its result doesn't land in the new tab.
    // The fetched conversation aborts via HydrationContext.signal; this side
    // also short-circuits the post-load DOM restore in `hydrateAndRender`.
    this.hydrationAbort?.abort();
    this.hydrationAbort = null;

    state.isSwitchingConversation = true;
    try {
      this.deps.dismissPendingInlinePrompts?.();
      // Drop any prior failure banner (and stale pending failure) before
      // hydrating the target conversation; a fresh failure re-arms it via the
      // hydrate below and is rendered in restoreConversation.
      renderer.clearHydrationBanner();
      this.deps.consumePendingHydrationError?.(id);
      await this.save();

      subagentManager.orphanAllActive();
      subagentManager.clear();

      // Phase A — instant UI swap. Bind the tab to the target conversation,
      // clear input + history dropdown, and render a spinner in place of the
      // message list. This runs entirely sync so `switchTo` resolves quickly
      // and the tab manager's switch guard releases right away, keeping the
      // UI responsive (and the user able to switch to yet another tab) while
      // the transcript loads in the background.
      state.currentConversationId = id;
      state.messages = [];
      state.usage = null;
      state.currentTodos = null;
      state.hasPendingConversationSave = false;
      this.deps.getInputEl().value = '';
      this.deps.clearQueuedMessage();
      this.deps.getHistoryDropdown()?.removeClass('visible');
      // Method-existence guard: unit tests stub `MessageRenderer` with a
      // partial shape that predates `renderLoading`. The spinner is purely
      // visual feedback — its absence is harmless in test environments.
      if (typeof renderer.renderLoading === 'function') {
        renderer.renderLoading(t('chat.history.loading'));
      }
      this.updateWelcomeVisibility();
    } finally {
      state.isSwitchingConversation = false;
    }

    // Phase B — async hydration + post-load restore. Not awaited; the spinner
    // stays visible until this resolves or another switch cancels it. The
    // `.catch` is mandatory: an unhandled rejection here would crash test
    // runners and trip Electron's unhandledRejection logs in production.
    const abort = new AbortController();
    this.hydrationAbort = abort;
    state.isHydrating = true;
    this.hydrationPromise = this.hydrateAndRender(id, abort).catch(() => {
      // `hydrateAndRender` surfaces user-visible failures inline (hydration
      // banner from `ConversationStore.loadSdkMessagesForConversation`).
      // Swallowing here is intentional — the spinner clears in `finally`.
    });
  }

  /**
   * Resolves when the most recent `switchTo`'s background hydration finishes
   * (or is aborted by an even newer switch). No-op when no hydration is
   * pending. Intended for tests + integration code that need post-hydrate
   * state to be visible.
   */
  async whenHydrated(): Promise<void> {
    while (this.hydrationPromise) {
      const pending = this.hydrationPromise;
      await pending;
      // Loop again if a fresh switch started a new hydration meanwhile.
      if (this.hydrationPromise === pending) break;
    }
  }

  /**
   * Loads the transcript for the target conversation, then completes the
   * deferred half of the tab switch (`ensureServiceForConversation` +
   * `restoreConversation`). A newer `switchTo` aborts this controller so the
   * stale result is dropped without touching the renderer.
   */
  private async hydrateAndRender(
    id: string,
    abort: AbortController,
  ): Promise<void> {
    const { plugin, state } = this.deps;
    try {
      // Yield to a macrotask so the browser commits the Phase A spinner
      // DOM before sync work in `restoreConversation` (DOM rebuild for the
      // 80-message window) starts. Microtask awaits alone do NOT trigger
      // paint — the cached-hydration path (active tab pre-warmed via
      // `restoreState`) resolves through microtasks only, so without this
      // yield the spinner stays invisible and the user only sees a freeze.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (abort.signal.aborted) return;

      const conversation = await plugin.switchConversation(id, { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!conversation) return;

      await this.deps.ensureServiceForConversation?.(conversation);
      if (abort.signal.aborted) return;

      this.restoreConversation(conversation);
      this.updateWelcomeVisibility();
      this.callbacks.onConversationSwitched?.();
    } finally {
      if (this.hydrationAbort === abort) {
        this.hydrationAbort = null;
        this.hydrationPromise = null;
        state.isHydrating = false;
      }
    }
  }

  async rewind(
    userMessageId: string,
    mode: ChatRewindMode = 'code-and-conversation',
  ): Promise<void> {
    const start = this.resolveRewindStart(userMessageId);
    if (!start.ok) {
      new Notice(start.notice);
      return;
    }
    const { userMsg, rewindUserMessageId, prevAssistantUuid } = start;

    const confirmed = await confirm(
      this.deps.plugin.app,
      rewindConfirmMessage(mode),
      t('chat.rewind.confirmButton')
    );
    if (!confirmed) return;

    if (this.deps.state.isStreaming) {
      new Notice(t('chat.rewind.unavailableStreaming'));
      return;
    }

    const outcome = await runRewind(this.getAgentService(), rewindUserMessageId, prevAssistantUuid, mode);
    if (!outcome.ok) {
      new Notice(outcome.notice);
      return;
    }

    await this.finalizeRewind(outcome.result, userMsg, userMessageId, prevAssistantUuid, mode);
  }

  /**
   * Runs the streaming/capability guards and resolves the rewind target. Returns
   * a ready-to-show notice on any rejection rather than emitting it, so `rewind`
   * stays a thin orchestrator.
   */
  private resolveRewindStart(userMessageId: string):
    | { ok: true; userMsg: ChatMessage; rewindUserMessageId: string; prevAssistantUuid: string }
    | { ok: false; notice: string } {
    const agentService = this.getAgentService();
    if (agentService && !agentService.getCapabilities().supportsRewind) {
      return { ok: false, notice: t('chat.rewind.failed', { error: t('chat.rewind.errUnsupported') }) };
    }
    if (this.deps.state.isStreaming) {
      return { ok: false, notice: t('chat.rewind.unavailableStreaming') };
    }

    const target = resolveRewindTarget(this.deps.state.messages, userMessageId);
    if (!target.ok) {
      const notice = target.noticeKey === 'errMessageNotFound'
        ? t('chat.rewind.failed', { error: t('chat.rewind.errMessageNotFound') })
        : t('chat.rewind.unavailableNoUuid');
      return { ok: false, notice };
    }

    return {
      ok: true,
      userMsg: target.userMsg,
      rewindUserMessageId: target.userMessageId,
      prevAssistantUuid: target.prevAssistantUuid,
    };
  }

  /** Truncates the transcript, re-renders, and persists the post-rewind state. */
  private async finalizeRewind(
    result: { filesChanged?: string[] },
    userMsg: ChatMessage,
    userMessageId: string,
    prevAssistantUuid: string,
    mode: ChatRewindMode,
  ): Promise<void> {
    const { state, renderer } = this.deps;
    state.truncateAt(userMessageId);

    const inputEl = this.deps.getInputEl();
    inputEl.value = userMsg.content;
    inputEl.focus();

    const welcomeEl = renderer.renderMessages(state.messages, () => this.getGreeting());
    this.deps.setWelcomeEl(welcomeEl);
    this.updateWelcomeVisibility();

    const filesChanged = result.filesChanged?.length ?? 0;
    let saveError: string | null = null;
    try {
      await this.save(false, { resumeAtMessageId: prevAssistantUuid });
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Failed to save';
    }

    new Notice(
      saveError
        ? rewindSaveFailedNotice(mode, filesChanged, saveError)
        : rewindSuccessNotice(mode, filesChanged)
    );
  }

  /**
   * Saves the current conversation.
   *
   * If we're at an entry point (no conversation yet) and have messages,
   * creates a new conversation first (lazy creation).
   *
   * For native sessions (new conversations with sessionId from SDK),
   * only metadata is saved - the SDK handles message persistence.
   */
  async save(updateLastResponse = false, options?: SaveOptions): Promise<void> {
    const { plugin, state } = this.deps;

    // Entry point with no messages - nothing to save
    if (!state.currentConversationId && state.messages.length === 0) {
      return;
    }

    const agentService = this.getAgentService();
    const sessionInvalidated = agentService?.consumeSessionInvalidation?.() ?? false;

    await ensureConversationForSave(plugin, state, agentService);

    const selections = collectSaveSelections(
      this.deps.getFileContextManager(),
      this.deps.getExternalContextSelector(),
      this.deps.getMcpServerSelector(),
    );

    const conversation = plugin.getConversationSync(state.currentConversationId!);
    const sessionUpdates = resolveSessionUpdates(agentService, conversation, sessionInvalidated);

    const updates = buildConversationUpdates({
      sessionUpdates,
      state,
      selections,
      workOrderPath: this.deps.getWorkOrderPath?.() ?? null,
      updateLastResponse,
      options,
    });

    await plugin.updateConversation(state.currentConversationId!, updates);
    state.hasPendingConversationSave = false;
  }

  /**
   * Shared logic for restoring a conversation into the current tab.
   * Used by both loadActive() and switchTo() to avoid duplication.
   */
  private restoreConversation(
    conversation: Conversation,
    options?: { autoAttachFile?: boolean }
  ): void {
    const { plugin, state, renderer } = this.deps;

    state.currentConversationId = conversation.id;
    state.messages = [...conversation.messages];
    state.usage = conversation.usage ?? null;
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
    state.hasPendingConversationSave = false;

    // Clear status panels (auto-hide: panels reappear when agent creates new todos)
    state.currentTodos = null;

    const hasMessages = state.messages.length > 0;

    // Determine external context paths for this session
    // Empty session: use persistent paths; session with messages: use saved paths
    const externalContextPaths = hasMessages
      ? conversation.externalContextPaths || []
      : plugin.settings.persistentExternalContextPaths || [];

    this.getAgentService()?.syncConversationState(conversation, externalContextPaths);

    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForLoadedConversation(hasMessages);

    if (conversation.currentNote) {
      fileCtx?.setCurrentNote(conversation.currentNote);
    } else if (!hasMessages && options?.autoAttachFile) {
      fileCtx?.autoAttachActiveFile();
    }

    this.restoreExternalContextPaths(conversation.externalContextPaths, !hasMessages);

    const mcpServerSelector = this.deps.getMcpServerSelector();
    if (conversation.enabledMcpServers && conversation.enabledMcpServers.length > 0) {
      mcpServerSelector?.setEnabledServers(conversation.enabledMcpServers);
    } else {
      mcpServerSelector?.clearEnabled();
    }

    // Chunked render: the welcome element is mounted synchronously so the
    // welcome-visibility check + setWelcomeEl can run immediately, but the
    // stored-message loop yields to the event loop every few entries so the
    // tab-switch UI (spinner from Phase A, sidebar, toolbar) stays responsive
    // instead of blocking on a multi-hundred-ms DOM rebuild. Method-existence
    // guard: unit tests stub `MessageRenderer` with a partial shape that
    // predates `renderMessagesChunked`; falling back to the sync renderer
    // keeps test expectations on mounted-message counts intact.
    const welcomeEl = typeof renderer.renderMessagesChunked === 'function'
      ? renderer.renderMessagesChunked(state.messages, () => this.getGreeting()).welcomeEl
      : renderer.renderMessages(state.messages, () => this.getGreeting());
    this.deps.setWelcomeEl(welcomeEl);

    // The tab is now bound to this conversation, so a hydration failure recorded
    // while it was opening can finally render its inline banner (the lookup at
    // emit time missed because the tab wasn't bound yet).
    const hydrationError = this.deps.consumePendingHydrationError?.(conversation.id);
    if (hydrationError) renderer.setHydrationError(hydrationError);
  }

  /**
   * Restores external context paths based on session state.
   * New or empty sessions get current persistent paths from settings.
   * Sessions with messages restore exactly what was saved.
   */
  private restoreExternalContextPaths(
    savedPaths: string[] | undefined,
    isEmptySession: boolean
  ): void {
    const { plugin } = this.deps;
    const externalContextSelector = this.deps.getExternalContextSelector();
    if (!externalContextSelector) {
      return;
    }

    if (isEmptySession) {
      // Empty session: use current persistent paths from settings
      externalContextSelector.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
    } else {
      // Session with messages: restore exactly what was saved
      externalContextSelector.setExternalContexts(savedPaths || []);
    }
  }

  // ============================================
  // History Dropdown
  // ============================================

  toggleHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    const isVisible = dropdown.hasClass('visible');
    if (isVisible) {
      dropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      dropdown.addClass('visible');
    }
  }

  updateHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    this.renderHistoryItems(dropdown, {
      onSelectConversation: (id) => this.switchTo(id),
      onRerender: () => this.updateHistoryDropdown(),
    });
  }

  /**
   * Renders history dropdown items to a container.
   * Shared implementation for updateHistoryDropdown() and renderHistoryDropdown().
   */
  private renderHistoryItems(
    container: HTMLElement,
    options: HistoryRenderOptions
  ): void {
    const { plugin } = this.deps;

    container.empty();

    const dropdownHeader = container.createDiv({ cls: 'claudian-history-header' });
    dropdownHeader.createSpan({ text: 'Conversations' });

    const list = container.createDiv({ cls: 'claudian-history-list' });
    const allConversations = plugin.getConversationList();

    if (allConversations.length === 0) {
      list.createDiv({ cls: 'claudian-history-empty', text: 'No conversations' });
      return;
    }

    // Sort by lastResponseAt (fallback to createdAt) descending
    const conversations = [...allConversations].sort((a, b) => {
      return (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt);
    });

    // Windowing hides everything past the first chunk behind "Show more". If the
    // active conversation is older than that cut (e.g. an old thread was just
    // reopened without a new response), pin it to the top so its "Current
    // session" row stays visible; otherwise recency order is untouched.
    const currentId = this.deps.state.currentConversationId;
    if (currentId) {
      const currentIdx = conversations.findIndex((c) => c.id === currentId);
      if (currentIdx >= HISTORY_RENDER_WINDOW_SIZE) {
        const [current] = conversations.splice(currentIdx, 1);
        conversations.unshift(current);
      }
    }

    // Window the list: mount only a trailing chunk and reveal older
    // conversations on demand, bounding DOM/listeners to O(window). Items stay
    // direct children of the list; the "show more" control is moved to the end
    // after each chunk so it always trails the revealed rows.
    let rendered = 0;
    const renderChunk = () => {
      const next = Math.min(rendered + HISTORY_RENDER_WINDOW_SIZE, conversations.length);
      for (let i = rendered; i < next; i++) {
        this.renderHistoryItem(list, conversations[i], options);
      }
      rendered = next;
    };

    renderChunk();

    if (rendered < conversations.length) {
      const showMore = list.createDiv({ cls: 'claudian-history-show-more' });
      const btn = showMore.createEl('button', {
        cls: 'claudian-history-show-more-btn',
        text: t('chat.history.showMore'),
        attr: { type: 'button' },
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderChunk();
        if (rendered < conversations.length) {
          // Re-append to keep the control after the freshly revealed rows.
          list.appendChild(showMore);
        } else {
          showMore.remove();
        }
      });
    }
  }

  private renderHistoryItem(
    list: HTMLElement,
    conv: ConversationMeta,
    options: HistoryRenderOptions,
  ): void {
    const { state } = this.deps;
    const isCurrent = conv.id === state.currentConversationId;
    const item = list.createDiv({
      cls: `claudian-history-item${isCurrent ? ' active' : ''}`,
    });

    const iconEl = item.createDiv({ cls: 'claudian-history-item-icon' });
    setIcon(iconEl, isCurrent ? 'message-square-dot' : 'message-square');

    const content = item.createDiv({ cls: 'claudian-history-item-content' });
    const titleEl = content.createDiv({ cls: 'claudian-history-item-title', text: conv.title });
    titleEl.setAttribute('title', conv.title);
    content.createDiv({
      cls: 'claudian-history-item-date',
      text: isCurrent ? 'Current session' : this.formatDate(conv.lastResponseAt ?? conv.createdAt),
    });

    if (!isCurrent) {
      content.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isHistoryNewTabModifierClick(e) && options.onOpenConversationInNewTab) {
          e.preventDefault();
          runConversationAction(
            () => this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conv.id, true),
              t('chat.history.loadFailed'),
            ),
            t('chat.history.loadFailed'),
          );
          return;
        }

        runConversationAction(
          () => this.runHistoryAction(
            () => options.onSelectConversation(conv.id),
            t('chat.history.loadFailed'),
          ),
          t('chat.history.loadFailed'),
        );
      });

      if (options.onOpenConversationInNewTab) {
        content.addEventListener('auxclick', (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          runConversationAction(
            () => this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conv.id, true),
              t('chat.history.loadFailed'),
            ),
            t('chat.history.loadFailed'),
          );
        });
      }
    }

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showHistoryContextMenu(item, conv.id, conv.title, isCurrent, options, e);
    });

    const actions = item.createDiv({ cls: 'claudian-history-item-actions' });

    // Show regenerate button if title generation failed, or loading indicator if pending
    if (conv.titleGenerationStatus === 'pending') {
      const loadingEl = actions.createEl('span', { cls: 'claudian-action-btn claudian-action-loading' });
      setIcon(loadingEl, 'loader-2');
      loadingEl.setAttribute('aria-label', 'Generating title...');
    } else if (conv.titleGenerationStatus === 'failed') {
      const regenerateBtn = actions.createEl('button', { cls: 'claudian-action-btn' });
      setIcon(regenerateBtn, 'refresh-cw');
      regenerateBtn.setAttribute('aria-label', 'Regenerate title');
      regenerateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        runConversationAction(
          () => this.regenerateTitle(conv.id),
          t('chat.history.regenerateFailed'),
        );
      });
    }

    const renameBtn = actions.createEl('button', { cls: 'claudian-action-btn' });
    setIcon(renameBtn, 'pencil');
    renameBtn.setAttribute('aria-label', 'Rename');
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRenameInput(item, conv.id, conv.title);
    });

    const deleteBtn = actions.createEl('button', { cls: 'claudian-action-btn claudian-delete-btn' });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runConversationAction(
        () => this.runHistoryAction(
          () => this.deleteHistoryConversation(conv.id, options),
          t('chat.history.deleteFailed'),
        ),
        t('chat.history.deleteFailed'),
      );
    });
  }

  private isHistoryNewTabModifierClick(event: MouseEvent): boolean {
    return !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey);
  }

  private async runHistoryAction(
    action: () => Promise<void> | void,
    errorMessage: string,
  ): Promise<void> {
    try {
      await action();
    } catch {
      new Notice(errorMessage);
    }
  }

  private showHistoryContextMenu(
    item: HTMLElement,
    conversationId: string,
    title: string,
    isCurrent: boolean,
    options: HistoryRenderOptions,
    event: MouseEvent,
  ): void {
    const menu = new Menu();
    const openState = options.getConversationOpenState?.(conversationId) ?? (isCurrent ? 'current' : 'closed');

    if (!isCurrent) {
      if (openState === 'closed' && options.onOpenConversationInNewTab) {
        menu.addItem((menuItem) => menuItem
          .setTitle('Open in new tab')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conversationId, true),
              'Failed to load conversation',
            );
          }));
        menu.addItem((menuItem) => menuItem
          .setTitle('Open in background tab')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conversationId, false),
              'Failed to load conversation',
            );
          }));
      } else if (openState === 'open') {
        menu.addItem((menuItem) => menuItem
          .setTitle('Switch to open session')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onSelectConversation(conversationId),
              'Failed to load conversation',
            );
          }));
      }
    }

    menu.addItem((menuItem) => menuItem
      .setTitle('Rename')
      .onClick(() => {
        this.showRenameInput(item, conversationId, title);
      }));
    menu.addItem((menuItem) => menuItem
      .setTitle('Delete')
      .onClick(() => {
        void this.runHistoryAction(
          () => this.deleteHistoryConversation(conversationId, options),
          'Failed to delete conversation',
        );
      }));

    menu.showAtMouseEvent(event);
  }

  private async deleteHistoryConversation(
    conversationId: string,
    options: HistoryRenderOptions,
  ): Promise<void> {
    const { plugin, state } = this.deps;
    if (state.isStreaming) return;

    await plugin.deleteConversation(conversationId);
    options.onRerender();

    if (conversationId === state.currentConversationId) {
      await this.loadActive();
    }
  }

  /** Shows inline rename input for a conversation. */
  private showRenameInput(item: HTMLElement, convId: string, currentTitle: string): void {
    const titleEl = item.querySelector('.claudian-history-item-title') as HTMLElement;
    if (!titleEl) return;

    const input = (item.ownerDocument ?? window.document).createElement('input');
    input.type = 'text';
    input.className = 'claudian-rename-input';
    input.value = currentTitle;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      try {
        const newTitle = input.value.trim() || currentTitle;
        await this.deps.plugin.renameConversation(convId, newTitle);
        this.updateHistoryDropdown();
      } catch {
        new Notice(t('chat.history.renameFailed'));
      }
    };

    input.addEventListener('blur', () => {
      runConversationAction(finishRename, t('chat.history.renameFailed'));
    });
    input.addEventListener('keydown', (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.isComposing) {
        input.blur();
      } else if (e.key === 'Escape' && !e.isComposing) {
        input.value = currentTitle;
        input.blur();
      }
    });
  }

  // ============================================
  // Welcome & Greeting
  // ============================================

  /** Generates a dynamic greeting based on time/day. */
  getGreeting(): string {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const name = this.deps.plugin.settings.userName?.trim();

    // Helper to optionally personalize a greeting (with fallback for no-name case)
    const personalize = (base: string, noNameFallback?: string): string =>
      name ? `${base}, ${name}` : (noNameFallback ?? base);

    // Day-specific greetings (some personalized, some universal)
    const dayGreetings: Record<number, string[]> = {
      0: [personalize('Happy Sunday'), 'Sunday session?', 'Welcome to the weekend'],
      1: [personalize('Happy Monday'), personalize('Back at it', 'Back at it!')],
      2: [personalize('Happy Tuesday')],
      3: [personalize('Happy Wednesday')],
      4: [personalize('Happy Thursday')],
      5: [personalize('Happy Friday'), personalize('That Friday feeling')],
      6: [personalize('Happy Saturday', 'Happy Saturday!'), personalize('Welcome to the weekend')],
    };

    // Time-specific greetings
    const getTimeGreetings = (): string[] => {
      if (hour >= 5 && hour < 12) {
        return [personalize('Good morning'), 'Coffee and Claudian time?'];
      } else if (hour >= 12 && hour < 18) {
        return [personalize('Good afternoon'), personalize('Hey there'), personalize("How's it going") + '?'];
      } else if (hour >= 18 && hour < 22) {
        return [personalize('Good evening'), personalize('Evening'), personalize('How was your day') + '?'];
      } else {
        return ['Hello, night owl', personalize('Evening')];
      }
    };

    // General greetings
    const generalGreetings = [
      personalize('Hey there'),
      name ? `Hi ${name}, how are you?` : 'Hi, how are you?',
      personalize("How's it going") + '?',
      personalize('Welcome back') + '!',
      personalize("What's new") + '?',
      ...(name ? [`${name} returns!`] : []),
      'You are absolutely right!',
    ];

    // Combine day + time + general greetings, pick randomly
    const allGreetings = [
      ...(dayGreetings[day] || []),
      ...getTimeGreetings(),
      ...generalGreetings,
    ];

    return allGreetings[Math.floor(Math.random() * allGreetings.length)];
  }

  /** Updates welcome element visibility based on message count. */
  updateWelcomeVisibility(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    if (this.deps.state.messages.length === 0) {
      welcomeEl.removeClass('claudian-hidden');
    } else {
      welcomeEl.addClass('claudian-hidden');
    }
  }

  /**
   * Initializes the welcome greeting for a new tab without a conversation.
   * Called when a new tab is activated and has no conversation loaded.
   */
  initializeWelcome(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    // Initialize file context to auto-attach the currently focused note
    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForNewConversation();
    fileCtx?.autoAttachActiveFile();

    // Only add greeting if not already present
    if (!welcomeEl.querySelector('.claudian-welcome-greeting')) {
      welcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: this.getGreeting() });
    }

    this.updateWelcomeVisibility();
  }

  // ============================================
  // Utilities
  // ============================================

  /** Generates a fallback title from the first message (used when AI fails). */
  generateFallbackTitle(firstMessage: string): string {
    const firstSentence = firstMessage.split(/[.!?\n]/)[0].trim();
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? '...' : '';
    return `${autoTitle}${suffix}`;
  }

  /** Regenerates AI title for a conversation. */
  async regenerateTitle(conversationId: string): Promise<void> {
    const { plugin } = this.deps;
    if (!plugin.settings.enableAutoTitleGeneration) return;

    // Title generation is delegated to the active provider service
    const fullConv = await plugin.getConversationById(conversationId);
    if (!fullConv || fullConv.messages.length < 1) return;

    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) return;

    // Find first user message by role (not by index)
    const firstUserMsg = fullConv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return;

    const userContent = firstUserMsg.displayContent || firstUserMsg.content;

    // Store current title to check if user renames during generation
    const expectedTitle = fullConv.title;

    // Set pending status before starting generation
    await plugin.updateConversation(conversationId, { titleGenerationStatus: 'pending' });
    this.updateHistoryDropdown();

    // Fire async AI title generation
    await titleService.generateTitle(
      conversationId,
      userContent,
      async (convId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(convId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches expected)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(convId, result.title);
          await plugin.updateConversation(convId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep existing title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(convId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(convId, { titleGenerationStatus: undefined });
        }
        this.updateHistoryDropdown();
      }
    );
  }

  /** Formats a timestamp for display. */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ============================================
  // History Dropdown Rendering (for ClaudianView)
  // ============================================

  /**
   * Renders the history dropdown content to a provided container.
   * Used by ClaudianView to render the dropdown with custom selection callback.
   */
  renderHistoryDropdown(
    container: HTMLElement,
    options: Omit<HistoryRenderOptions, 'onRerender'>,
  ): void {
    this.renderHistoryItems(container, {
      ...options,
      onRerender: () => this.renderHistoryDropdown(container, options),
    });
  }
}
