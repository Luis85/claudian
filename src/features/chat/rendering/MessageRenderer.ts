import type { App, Component } from 'obsidian';
import { MarkdownRenderer, TFile, TFolder } from 'obsidian';

import { DEFAULT_CHAT_PROVIDER_ID, type ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRewindMode } from '../../../core/runtime/types';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';
import type { ChatMessage, ImageAttachment, ToolCallInfo } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { processFileLinks, registerFileLinkHandler } from '../../../utils/fileLink';
import { replaceImageEmbedsWithHtml } from '../../../utils/imageEmbed';
import { escapeMathDelimitersForStreaming } from '../../../utils/markdownMath';
import { openClaudianProviderSettings } from '../../../utils/obsidianPrivateApi';
import { extractVaultMentions } from '../../../utils/vaultMentions';
import { findRewindContext } from '../rewind';
import {
  type AssistantContentHost,
  renderAssistantMessageContent,
} from './assistantMessageContent';
import { MessageActionBar } from './MessageActionBar';
import { renderMessageContextCard } from './MessageContextCard';
import { MessageImageRenderer } from './MessageImageRenderer';
import { MessageSubagentRenderer } from './MessageSubagentRenderer';
import { scrollMessagesToBottom } from './scrollToBottom';
import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';
import { renderStoredToolCall } from './ToolCallRenderer';
import { hasVisibleBlock, hasVisibleText } from './visibleContentHelpers';
import { RENDER_WINDOW_SIZE, setupWindowedRender } from './windowedRenderSetup';
import { renderWorkOrderHandoffCard } from './WorkOrderHandoffCard';
import { renderWorkOrderNeedsApprovalCard } from './WorkOrderNeedsApprovalCard';
import { renderWorkOrderNeedsInputCard } from './WorkOrderNeedsInputCard';
import { renderWorkOrderProgressCard } from './WorkOrderProgressCard';
import {
  splitWorkOrderProtocolForDisplay,
  type WorkOrderProtocolSegment,
} from './WorkOrderProtocolDisplay';
import { renderStoredWriteEdit } from './WriteEditRenderer';

/**
 * Hard-coded signature line emitted by `renderTaskPrompt` for work-order
 * execution prompts. Used to collapse the prompt behind a `<details>` toggle
 * so the chat stays readable.
 */
const WORK_ORDER_PROMPT_SIGNATURE = 'You are executing a Claudian work order.';

function isWorkOrderExecutionPrompt(text: string): boolean {
  return text.includes(WORK_ORDER_PROMPT_SIGNATURE);
}

export interface RenderContentOptions {
  deferMath?: boolean;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions
) => Promise<void>;

/**
 * Returns the direct `.claudian-response-footer` child of `contentEl`, if any.
 * Direct-child only on purpose: `:scope > .x` is not portable through our
 * tests' minimal DOM mock, so this iterates the live `children` array instead.
 */
function findResponseFooterChild(contentEl: HTMLElement): HTMLElement | null {
  const children = contentEl.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HTMLElement;
    if (child.classList?.contains('claudian-response-footer')) return child;
  }
  return null;
}

function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

/** Optional host hooks wired by the owning tab; all default to inert no-ops. */
export interface MessageRendererHooks {
  rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>;
  forkCallback?: (messageId: string) => Promise<void>;
  getCapabilities?: () => ProviderCapabilities;
  getWorkOrderPath?: () => string | null | undefined;
}

export class MessageRenderer {
  private app: App;
  private plugin: ClaudianPlugin;
  private component: Component;
  private messagesEl: HTMLElement;
  private rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>;
  private getCapabilities: () => ProviderCapabilities;
  private getWorkOrderPath: () => string | null | undefined;
  private forkCallback?: (messageId: string) => Promise<void>;
  private liveMessageEls = new Map<string, HTMLElement>();
  private windowedMessages: ChatMessage[] = [];
  private renderWindowStart = 0;
  private loadEarlierEl: HTMLElement | null = null;
  private hydrationError: { code: string; message: string } | null = null;
  /**
   * Monotonic counter bumped on every {@link renderMessagesChunked} call so
   * the async chunked render aborts when a newer render lands. Without it a
   * stale yield-resume could keep appending messages from a superseded
   * transcript into the new tab's DOM.
   */
  private chunkedRenderGeneration = 0;
  private subagentRendererInstance: MessageSubagentRenderer | null = null;
  private actionBarInstance: MessageActionBar | null = null;
  private imageRendererInstance: MessageImageRenderer | null = null;

  constructor(
    plugin: ClaudianPlugin,
    component: Component,
    messagesEl: HTMLElement,
    hooks: MessageRendererHooks = {},
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.component = component;
    this.messagesEl = messagesEl;
    this.rewindCallback = hooks.rewindCallback;
    this.forkCallback = hooks.forkCallback;
    this.getWorkOrderPath = hooks.getWorkOrderPath ?? (() => null);
    this.getCapabilities = hooks.getCapabilities ?? (() => ({
      providerId: DEFAULT_CHAT_PROVIDER_ID,
      supportsPersistentRuntime: false,
      supportsNativeHistory: false,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: false,
      supportsInstructionMode: false,
      supportsMcpTools: false,
      supportsTurnSteer: false,
      reasoningControl: 'none' as const,
    }));

    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }

  /** Sets the messages container element. */
  setMessagesEl(el: HTMLElement): void {
    this.messagesEl = el;
  }

  private getSubagentLifecycleAdapter(toolName?: string) {
    return resolveSubagentLifecycleAdapter(this.getCapabilities().providerId, toolName);
  }

  private get subagentRenderer(): MessageSubagentRenderer {
    if (!this.subagentRendererInstance) {
      this.subagentRendererInstance = new MessageSubagentRenderer({
        app: this.app,
        getCapabilities: () => this.getCapabilities(),
      });
    }
    return this.subagentRendererInstance;
  }

  private get actionBar(): MessageActionBar {
    if (!this.actionBarInstance) {
      this.actionBarInstance = new MessageActionBar({
        plugin: this.plugin,
        getCapabilities: () => this.getCapabilities(),
        rewindCallback: this.rewindCallback,
        forkCallback: this.forkCallback,
        isRewindEligible: (allMessages, index) => this.isRewindEligible(allMessages, index),
        getMessageEl: (messageId) => this.getMessageEl(messageId),
        getLiveMessageEl: (messageId) => this.liveMessageEls.get(messageId),
        deleteLiveMessageEl: (messageId) => { this.liveMessageEls.delete(messageId); },
      });
    }
    return this.actionBarInstance;
  }

  private get imageRenderer(): MessageImageRenderer {
    if (!this.imageRendererInstance) {
      this.imageRendererInstance = new MessageImageRenderer({
        app: this.app,
        getOwnerDocument: () => this.messagesEl.ownerDocument ?? window.document,
      });
    }
    return this.imageRendererInstance;
  }

  /**
   * Renders a user message text block, collapsing the long work-order execution
   * prompt behind a `<details>` toggle to keep the chat readable. Detection is
   * by the hard-coded signature line emitted by `renderTaskPrompt`.
   */
  private renderUserTextBlock(contentEl: HTMLElement, text: string): void {
    if (isWorkOrderExecutionPrompt(text)) {
      const details = contentEl.createEl('details', { cls: 'claudian-work-order-prompt' });
      details.createEl('summary', {
        cls: 'claudian-work-order-prompt-summary',
        text: 'Work order prompt',
      });
      const textEl = details.createDiv({ cls: 'claudian-text-block' });
      void this.renderContent(textEl, text);
      return;
    }
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
    void this.renderContent(textEl, text);
  }

  private renderUserContextCard(contentEl: HTMLElement, msg: ChatMessage): void {
    if (msg.isRebuiltContext) return;
    // Use msg.content (not displayContent) so that pill-folded @mentions are always
    // detected — displayContent is clean prose when pills are active.
    const sourceText = msg.content;
    if (!sourceText) return;

    const mentions = extractVaultMentions(sourceText, (path) => {
      const entry = this.app.vault.getAbstractFileByPath(path);
      if (entry instanceof TFile) return 'file';
      if (entry instanceof TFolder) return 'folder';
      return null;
    });

    renderMessageContextCard(contentEl, mentions, {
      onOpenFile: (path) => {
        // Open in a tab so clicking a context reference doesn't replace the active editor.
        void this.app.workspace.openLinkText(path, '', 'tab');
      },
    });
  }

  // ============================================
  // Streaming Message Rendering
  // ============================================

  /**
   * Adds a new message to the chat during streaming.
   * Returns the message element for content updates.
   */
  addMessage(msg: ChatMessage): HTMLElement {
    // Render images above message bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (!textToShow) {
        this.scrollToBottom();
        const lastChild = this.messagesEl.lastElementChild as HTMLElement;
        return lastChild ?? this.messagesEl;
      }
    }

    const { msgEl, contentEl } = this.createMessageShell(msg);

    if (msg.role === 'user') {
      this.renderUserContextCard(contentEl, msg);
      const textToShow = msg.displayContent ?? msg.content;
      if (textToShow) {
        this.renderUserTextBlock(contentEl, textToShow);
        this.actionBar.addUserCopyButton(msgEl, textToShow);
        this.actionBar.addRegisteredMessageActions(msgEl, msg);
      }
      if (this.rewindCallback || this.forkCallback) {
        this.liveMessageEls.set(msg.id, msgEl);
      }
    }

    this.scrollToBottom();
    return msgEl;
  }

  updateLiveUserMessage(msg: ChatMessage): void {
    if (msg.role !== 'user') {
      return;
    }

    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) {
      return;
    }

    const contentEl = msgEl.querySelector<HTMLElement>('.claudian-message-content');
    if (!contentEl) {
      return;
    }

    contentEl.empty();
    this.renderUserContextCard(contentEl, msg);

    const textToShow = msg.displayContent ?? msg.content;
    if (textToShow) {
      this.renderUserTextBlock(contentEl, textToShow);
    }

    const toolbar = msgEl.querySelector<HTMLElement>('.claudian-user-msg-actions');
    if (toolbar) {
      toolbar.querySelectorAll('.claudian-user-msg-copy-btn').forEach((el) => el.remove());
      toolbar.querySelectorAll('.claudian-user-msg-action-btn').forEach((el) => el.remove());
    }

    if (textToShow) {
      this.actionBar.addUserCopyButton(msgEl, textToShow);
      this.actionBar.addRegisteredMessageActions(msgEl, msg);
    }
  }

  getMessageEl(messageId: string): HTMLElement | null {
    return this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  }

  removeMessage(messageId: string): void {
    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!msgEl) {
      return;
    }

    msgEl.remove();
    this.liveMessageEls.delete(messageId);
  }

  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================

  /**
   * Renders all messages for conversation load/switch.
   * @param messages Array of messages to render
   * @param getGreeting Function to get greeting text
   * @returns The newly created welcome element
   */
  /**
   * Renders an inline loading state in place of the message list. Called the
   * instant a tab switch begins so the user sees an immediate visual ack
   * instead of a blank pane while the transcript is hydrated in the
   * background. Subsequent {@link renderMessages} replaces the spinner.
   */
  renderLoading(loadingText: string): void {
    this.messagesEl.empty();
    this.liveMessageEls.clear();
    this.loadEarlierEl = null;
    this.windowedMessages = [];
    const loader = this.messagesEl.createDiv({ cls: 'claudian-loading' });
    loader.createDiv({ cls: 'claudian-loading-spinner' });
    loader.createDiv({ cls: 'claudian-loading-text', text: loadingText });
  }

  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string
  ): HTMLElement {
    this.messagesEl.empty();
    this.liveMessageEls.clear();
    this.loadEarlierEl = null;
    this.windowedMessages = messages;
    // Bump the chunked-render generation so any background loop from a prior
    // `renderMessagesChunked` call observes the supersession and bails before
    // appending stale rows into this freshly-emptied pane.
    this.chunkedRenderGeneration += 1;

    // A hydration failure is surfaced as a banner kept in renderer state, not as
    // a one-shot DOM insert. `empty()` above wiped any prior copy, so the shared
    // setup re-renders it from state — otherwise the banner the failure
    // subscriber adds before this restore-driven render would be silently
    // dropped, leaving a blank pane.
    const { welcomeEl: newWelcomeEl, start } = this.setupWindowedRender(messages.length, getGreeting);
    this.renderWindowStart = start;

    for (let i = start; i < messages.length; i++) {
      this.renderStoredMessage(messages[i], messages, i);
    }

    this.scrollToBottom();
    return newWelcomeEl;
  }

  /**
   * Cooperative variant of {@link renderMessages} that yields to the event
   * loop every {@link CHUNK_SIZE} messages. Used by the tab-switch / load-
   * conversation paths so DOM rebuild of an 80-message window does not block
   * the main thread for hundreds of milliseconds — the user keeps the spinner
   * (Phase A) visible until the first chunk lands, then messages stream in
   * progressively, and other Obsidian UI stays interactive between chunks.
   *
   * The returned `welcomeEl` is created synchronously so callers can wire
   * `setWelcomeEl` + welcome visibility right away. `finished` resolves once
   * the entire window has mounted, or earlier if a newer render aborts this
   * one (see {@link chunkedRenderGeneration}).
   */
  renderMessagesChunked(
    messages: ChatMessage[],
    getGreeting: () => string,
  ): { welcomeEl: HTMLElement; finished: Promise<void> } {
    const CHUNK_SIZE = 5;

    this.messagesEl.empty();
    this.liveMessageEls.clear();
    this.loadEarlierEl = null;
    this.windowedMessages = messages;
    const generation = ++this.chunkedRenderGeneration;

    const { welcomeEl: newWelcomeEl, start } = this.setupWindowedRender(messages.length, getGreeting);
    this.renderWindowStart = start;

    const finished = (async () => {
      for (let i = start; i < messages.length; i++) {
        if (generation !== this.chunkedRenderGeneration) return;
        this.renderStoredMessage(messages[i], messages, i);
        if ((i - start + 1) % CHUNK_SIZE === 0 && i + 1 < messages.length) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }
      if (generation === this.chunkedRenderGeneration) {
        this.scrollToBottom();
      }
    })();

    return { welcomeEl: newWelcomeEl, finished };
  }

  /** Binds the shared windowed-render setup to this renderer's callbacks. */
  private setupWindowedRender(
    total: number,
    getGreeting: () => string,
  ): { welcomeEl: HTMLElement; start: number } {
    return setupWindowedRender({
      messagesEl: this.messagesEl,
      getGreeting,
      renderHydrationErrorBanner: () => this.renderHydrationErrorBanner(),
      renderLoadEarlierControl: () => this.renderLoadEarlierControl(),
      total,
    });
  }

  /**
   * Records a history hydration failure and shows it as an inline banner. The
   * error is held in renderer state so it survives the `renderMessages` that
   * `restoreConversation` runs right after `ConversationStore` emits the
   * failure — see the re-render in {@link renderMessages}.
   */
  setHydrationError(error: { code: string; message: string }): void {
    this.hydrationError = error;
    this.renderHydrationErrorBanner();
  }

  /**
   * Drops any recorded hydration failure and removes its banner. Called before
   * hydrating a switched / reloaded conversation so a previous failure does not
   * linger on a healthy pane.
   */
  clearHydrationBanner(): void {
    this.hydrationError = null;
    this.messagesEl.querySelector('.claudian-hydration-error')?.remove();
  }

  private renderHydrationErrorBanner(): void {
    this.messagesEl.querySelector('.claudian-hydration-error')?.remove();
    if (!this.hydrationError) return;
    const banner = this.messagesEl.createDiv({ cls: 'claudian-hydration-error' });
    banner.setText(this.hydrationError.message);
    banner.dataset.errorCode = this.hydrationError.code;
  }

  private renderLoadEarlierControl(): void {
    const el = this.messagesEl.createDiv({ cls: 'claudian-load-earlier' });
    const btn = el.createEl('button', {
      cls: 'claudian-load-earlier-btn',
      text: t('chat.loadEarlier'),
      attr: { type: 'button' },
    });
    btn.addEventListener('click', () => this.loadEarlierMessages());
    this.loadEarlierEl = el;
  }

  /**
   * Mounts the previous chunk of earlier messages above the current window.
   * Renders into a detached node first, then splices it in right after the control
   * so global message indices (rewind eligibility via {@link isRewindEligible}) and
   * document order are preserved.
   */
  private loadEarlierMessages(): void {
    const control = this.loadEarlierEl;
    const oldStart = this.renderWindowStart;
    if (!control || oldStart <= 0) return;

    const newStart = Math.max(0, oldStart - RENDER_WINDOW_SIZE);

    // Inserting content above the viewport shifts everything down; capture pre-insert
    // metrics so the user's scroll position stays anchored to the same message.
    const prevScrollHeight = this.messagesEl.scrollHeight;
    const prevScrollTop = this.messagesEl.scrollTop;

    const target = this.messagesEl;
    const staging = target.ownerDocument.createElement('div');
    this.messagesEl = staging;
    try {
      for (let i = newStart; i < oldStart; i++) {
        this.renderStoredMessage(this.windowedMessages[i], this.windowedMessages, i);
      }
    } finally {
      this.messagesEl = target;
    }

    // Snapshot before moving: inserting a node detaches it from `staging`, and a
    // captured array also avoids relying on a live `firstChild` loop.
    const anchor = control.nextSibling;
    for (const node of Array.from(staging.children)) {
      target.insertBefore(node, anchor);
    }

    this.renderWindowStart = newStart;
    if (newStart === 0) {
      control.remove();
      this.loadEarlierEl = null;
    }

    target.scrollTop = prevScrollTop + (target.scrollHeight - prevScrollHeight);
  }

  renderStoredMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    // Bare interrupt marker: user-role interrupts (Claude bracket markers) always render
    // as a standalone indicator. Assistant-role interrupts (Codex partial responses)
    // only use the bare marker when there's no content to preserve.
    if (msg.isInterrupt && (msg.role === 'user' || !this.hasVisibleContent(msg))) {
      this.renderInterruptMessage();
      return;
    }

    // Skip rebuilt context messages (history sent to SDK on session reset)
    // These are internal context for the AI, not actual user messages to display
    if (msg.isRebuiltContext) {
      return;
    }

    if (msg.role === 'user') {
      this.renderStoredUserMessage(msg, allMessages, index);
      return;
    }
    this.renderStoredAssistantMessage(msg);
  }

  private renderStoredUserMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    // Render images above bubble for user messages
    if (msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    const textToShow = msg.displayContent ?? msg.content;
    if (!textToShow) {
      return;
    }

    const { msgEl, contentEl } = this.createMessageShell(msg);
    this.renderUserContextCard(contentEl, msg);
    this.renderUserTextBlock(contentEl, textToShow);
    this.actionBar.addUserCopyButton(msgEl, textToShow);
    this.actionBar.addRegisteredMessageActions(msgEl, msg);
    if (msg.userMessageId && this.isRewindEligible(allMessages, index)) {
      if (this.rewindCallback) {
        this.actionBar.addRewindButton(msgEl, msg.id);
      }
      if (this.forkCallback) {
        this.actionBar.addForkButton(msgEl, msg.id);
      }
    }
  }

  private renderStoredAssistantMessage(msg: ChatMessage): void {
    if (!this.hasVisibleContent(msg)) {
      return;
    }

    const { msgEl, contentEl } = this.createMessageShell(msg);
    this.renderAssistantContent(msg, contentEl);
    if (msg.isInterrupt) {
      this.appendInterruptIndicator(contentEl);
    }
    this.actionBar.addAssistantMessageActions(msgEl, msg);
  }

  private createMessageShell(msg: ChatMessage): { msgEl: HTMLElement; contentEl: HTMLElement } {
    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-message claudian-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });
    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content', attr: { dir: 'auto' } });
    return { msgEl, contentEl };
  }

  private hasVisibleContent(msg: ChatMessage): boolean {
    const isToolVisible = (toolId: string): boolean => {
      const toolCall = msg.toolCalls?.find(tc => tc.id === toolId);
      return Boolean(toolCall && this.shouldRenderToolCall(toolCall));
    };
    if (hasVisibleText(msg)) return true;
    if (hasVisibleBlock(msg.contentBlocks, isToolVisible)) return true;
    return Boolean(msg.toolCalls?.some(toolCall => this.shouldRenderToolCall(toolCall)));
  }

  private isRewindEligible(allMessages?: ChatMessage[], index?: number): boolean {
    if (!allMessages || index === undefined) return false;
    const ctx = findRewindContext(allMessages, index);
    return !!ctx.prevAssistantUuid && ctx.hasResponse;
  }

  private renderInterruptMessage(): void {
    const msgEl = this.messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content', attr: { dir: 'auto' } });
    this.appendInterruptIndicator(contentEl);
  }

  private appendInterruptIndicator(contentEl: HTMLElement): void {
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
    textEl.createSpan({ cls: 'claudian-interrupted', text: 'Interrupted' });
    textEl.appendText(' ');
    textEl.createSpan({
      cls: 'claudian-interrupted-hint',
      text: '\u00B7 What should Claudian do instead?',
    });
  }

  private renderAssistantTextBlock(contentEl: HTMLElement, markdown: string): void {
    if (!this.getWorkOrderPath()) {
      this.renderPlainAssistantTextBlock(contentEl, markdown);
      return;
    }
    const segments = splitWorkOrderProtocolForDisplay(markdown);
    for (const segment of segments) {
      this.renderAssistantDisplaySegment(contentEl, segment);
    }
  }

  private renderPlainAssistantTextBlock(contentEl: HTMLElement, markdown: string): void {
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
    void this.renderContent(textEl, markdown);
    this.addTextCopyButton(textEl, markdown);
  }

  private renderAssistantDisplaySegment(contentEl: HTMLElement, segment: WorkOrderProtocolSegment): void {
    switch (segment.type) {
      case 'markdown':
        this.renderPlainAssistantTextBlock(contentEl, segment.content);
        return;
      case 'progress':
        renderWorkOrderProgressCard(contentEl, segment.progress);
        return;
      case 'needs_input':
        renderWorkOrderNeedsInputCard(contentEl, segment.needsInput);
        return;
      case 'needs_approval':
        renderWorkOrderNeedsApprovalCard(contentEl, segment.needsApproval);
        return;
      case 'handoff':
        renderWorkOrderHandoffCard(contentEl, segment, (el, md, options) => this.renderContent(el, md, options));
        return;
      default: {
        const _exhaustive: never = segment;
        void _exhaustive;
      }
    }
  }

  /**
   * Streaming finalize hook: when a work-order run's final text block holds a
   * complete handoff, drop the raw text element and render the compact card (plus
   * any surrounding markdown) in its place. Returns true when it replaced the
   * block; no-ops (returns false) outside work-order tabs or without a valid
   * single handoff, leaving the caller to keep the raw text block. The stored
   * `text` content block is untouched, so persistence and reload stay unchanged.
   */
  finalizeStreamedAssistantText(
    contentEl: HTMLElement,
    textEl: HTMLElement,
    markdown: string,
  ): boolean {
    if (!this.getWorkOrderPath()) return false;
    const segments = splitWorkOrderProtocolForDisplay(markdown);
    if (segments.every((s) => s.type === 'markdown')) return false;

    // A live run that took long enough to bake a duration footer attaches
    // `.claudian-response-footer` to `contentEl` BEFORE finalize runs. Since
    // `renderAssistantDisplaySegment` appends new children, naïvely removing
    // `textEl` and rendering would leave the card BELOW the footer — while a
    // reload renders the card above. Detach the footer first, render the card,
    // then re-append it so live + stored DOM order stays identical.
    const footerEl = findResponseFooterChild(contentEl);
    footerEl?.remove();
    textEl.remove();
    for (const segment of segments) {
      this.renderAssistantDisplaySegment(contentEl, segment);
    }
    if (footerEl) contentEl.appendChild(footerEl);
    return true;
  }

  /**
   * Renders assistant message content (content blocks or fallback). Block
   * dispatch lives in `assistantMessageContent.ts` behind a host interface.
   */
  private renderAssistantContent(msg: ChatMessage, contentEl: HTMLElement): void {
    renderAssistantMessageContent(this.assistantContentHost(), msg, contentEl);
  }

  private assistantContentHost(): AssistantContentHost {
    return {
      getProviderId: () => this.getCapabilities().providerId,
      openProviderSettings: (providerId) => {
        openClaudianProviderSettings(this.app, this.plugin.manifest.id, providerId);
      },
      renderMarkdown: (el, md) => this.renderContent(el, md),
      renderTextBlock: (el, md) => this.renderAssistantTextBlock(el, md),
      renderToolCall: (el, toolCall, msg) => this.renderToolCall(el, toolCall, msg),
      renderTaskSubagent: (el, toolCall, mode) => this.subagentRenderer.renderTaskSubagent(el, toolCall, mode),
    };
  }

  /**
   * Renders a tool call with special handling for Write/Edit, Agent (subagent),
   * and Codex collab agent lifecycle tools.
   */
  private renderToolCall(contentEl: HTMLElement, toolCall: ToolCallInfo, msg?: ChatMessage): void {
    if (!this.shouldRenderToolCall(toolCall)) return;
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);

    if (isWriteEditTool(toolCall.name)) {
      renderStoredWriteEdit(this.app, contentEl, toolCall, { initiallyExpanded: this.plugin.settings.expandFileEditsByDefault === true });
    } else if (isSubagentToolName(toolCall.name)) {
      this.subagentRenderer.renderTaskSubagent(contentEl, toolCall);
    } else if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name) && msg) {
      this.subagentRenderer.renderProviderLifecycleSubagent(contentEl, toolCall, msg);
    } else {
      renderStoredToolCall(this.app, contentEl, toolCall);
    }
  }

  private shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
    if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
    if (toolCall.name === TOOL_WRITE_STDIN && this.isSilentWriteStdinTool(toolCall)) return false;
    if (toolCall.name === 'custom_tool_call_output') return false;

    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);
    if (subagentLifecycleAdapter?.isHiddenTool(toolCall.name)) return false;

    return true;
  }

  private isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
    return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
  }

  // ============================================
  // Image Rendering
  // ============================================

  /** Sets image src from attachment — prefers vault file over base64 blob. */
  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    this.imageRenderer.setImageSrc(imgEl, image);
  }

  /** Renders image attachments above a message. */
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    this.imageRenderer.renderMessageImages(containerEl, images);
  }

  /** Shows full-size image in modal overlay. */
  showFullImage(image: ImageAttachment): void {
    this.imageRenderer.showFullImage(image);
  }

  // ============================================
  // Content Rendering
  // ============================================

  /**
   * Renders markdown content with code block enhancements.
   */
  async renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions
  ): Promise<void> {
    el.empty();

    try {
      const renderMarkdown = options?.deferMath
        ? escapeMathDelimitersForStreaming(markdown)
        : markdown;
      // Normalize embeds before MarkdownRenderer consumes them.
      const processedMarkdown = replaceImageEmbedsWithHtml(
        renderMarkdown,
        this.app,
        { mediaFolder: this.plugin.settings.mediaFolder }
      );
      await MarkdownRenderer.render(
        this.app,
        processedMarkdown,
        el,
        '',
        this.component
      );

      // Wrap pre elements and move buttons outside scroll area
      el.querySelectorAll('pre').forEach((pre) => {
        // Skip if already wrapped
        if (pre.parentElement?.classList.contains('claudian-code-wrapper')) return;

        // Create wrapper
        const wrapper = createEl('div', { cls: 'claudian-code-wrapper' });
        pre.parentElement?.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // Check for language class and add label
        const code = pre.querySelector('code[class*="language-"]');
        if (code) {
          const match = code.className.match(/language-(\w+)/);
          if (match) {
            wrapper.classList.add('has-language');
            const label = createEl('span', {
              cls: 'claudian-code-lang-label',
              text: match[1],
            });
            wrapper.appendChild(label);
            label.addEventListener('click', () => {
              runRendererAction(async () => {
                const originalLabel = match[1];
                if (!originalLabel) return;

                try {
                  await navigator.clipboard.writeText(code.textContent || '');
                  label.setText('Copied!');
                  window.setTimeout(() => label.setText(originalLabel), 1500);
                } catch {
                  // Clipboard API may fail in non-secure contexts
                }
              });
            });
          }
        }

        // Move Obsidian's copy button outside pre into wrapper
        const copyBtn = pre.querySelector('.copy-code-button');
        if (copyBtn) {
          wrapper.appendChild(copyBtn);
        }
      });

      // Wikilinks and vault paths in assistant prose (Cursor often emits absolute paths in inline code).
      processFileLinks(this.app, el);
    } catch {
      el.createDiv({
        cls: 'claudian-render-error',
        text: 'Failed to render message content.',
      });
    }
  }

  // ============================================
  // Message Actions
  // ============================================

  /**
   * Adds a copy button to a text block.
   * Button shows clipboard icon on hover, changes to "copied!" on click.
   * @param textEl The rendered text element
   * @param markdown The original markdown content to copy
   */
  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    this.actionBar.addTextCopyButton(textEl, markdown);
  }

  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    this.actionBar.refreshActionButtons(msg, allMessages, index);
  }

  /** Adds registered message actions (e.g. Create work order) to a completed agent message. */
  refreshMessageActions(msg: ChatMessage): void {
    this.actionBar.refreshMessageActions(msg);
  }

  // ============================================
  // Utilities
  // ============================================

  /**
   * Scrolls the messages container to the bottom.
   *
   * Uses the trailing element's `scrollIntoView` instead of reading `scrollHeight`,
   * which would force a synchronous layout of the entire (unbounded) message DOM.
   */
  scrollToBottom(): void {
    scrollMessagesToBottom(this.messagesEl);
  }

  /** Scrolls to bottom if already near bottom (within threshold). */
  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      window.requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }

}
