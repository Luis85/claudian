import { Notice } from 'obsidian';

import type {
  BuiltInCommand,
} from '../../../core/commands/builtInCommands';
import {
  detectBuiltInCommand,
  isBuiltInCommandSupported,
} from '../../../core/commands/builtInCommands';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type InstructionRefineService,
  type ProviderCapabilities,
  type ProviderId,
  type TitleGenerationService,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import {
  cloneChatTurnRequest,
} from '../../../core/runtime/QueuedTurn';
import type {
  ApprovalCallbackOptions,
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
} from '../../../core/runtime/types';
import type { ApprovalDecision, ChatMessage, ExitPlanModeDecision, StreamChunk } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { ResumeSessionDropdown } from '../../../shared/components/ResumeSessionDropdown';
import { InstructionModal } from '../../../shared/modals/InstructionConfirmModal';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import type { EditorSelectionContext } from '../../../utils/editor';
import { appendMarkdownSnippet } from '../../../utils/markdown';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { persistPastedImages } from '../services/persistPastedImages';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';
import type { InstructionModeManager } from '../ui/InstructionModeManager';
import type { StatusPanel } from '../ui/StatusPanel';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import {
  applyPlanApprovalDecision,
  bakeResponseDurationFooter,
  beginStreamingTurnState,
  completeApprovedNewSessionPlanToolCalls,
  type ComposerSendContext,
  type ComposerTurnOptions,
  createAssistantPlaceholderMessage,
  createOutgoingUserMessage,
  type DispatchedTurnContext,
  type FinishedTurn,
  normalizeTabModelOverride,
  type OutgoingTurn,
  type PlanApprovalOutcome,
  resolveComposerSend,
  resolveComposerSourceImages,
  restoreResumeCheckpointIfNeeded,
} from './composerSendPhases';
import type { ConversationController } from './ConversationController';
import { InlinePromptController } from './InlinePromptController';
import { QueuedMessageController } from './QueuedMessageController';
import type { SelectionController } from './SelectionController';
import type { StreamController } from './StreamController';

export interface InputControllerDeps {
  plugin: ClaudianPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  conversationController: ConversationController;
  getInputEl: () => HTMLTextAreaElement;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  getInstructionModeManager: () => InstructionModeManager | null;
  getInstructionRefineService: () => InstructionRefineService | null;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getInputContainerEl: () => HTMLElement;
  generateId: () => string;
  resetInputHeight: () => void;
  getAuxiliaryModel?: () => string | null;
  getAgentService?: () => ChatRuntime | null;
  getSubagentManager: () => SubagentManager;
  /** Tab-level provider fallback for blank tabs (derived from draft model). */
  getTabProviderId?: () => ProviderId;
  /**
   * Roster agent id to bind to the lazily-created conversation for this tab
   * (e.g. `roster:foo`). Set for Agent Board task-run tabs whose work order
   * assigned a roster agent; absent for normal chat tabs. Once consumed by
   * `triggerTitleGeneration`, the tab clears it so subsequent rebinds don't
   * carry the stale id.
   */
  getBoundAgentId?: () => string | null | undefined;
  /**
   * Tab-pinned model that should override the provider's global `settings.model`
   * on the next send. Returns the work-order's selected model for Agent Board
   * task runs (and the draft model for blank tabs that haven't committed yet);
   * returns null/empty when no override applies. Captured BEFORE
   * `ensureServiceInitialized` runs because the tab lifecycle clears the draft
   * model during init.
   */
  getTabModelOverride?: () => string | null;
  /** Returns true if ready. */
  ensureServiceInitialized?: () => Promise<boolean>;
  openConversation?: (conversationId: string) => Promise<void>;
  onForkAll?: () => Promise<void>;
  restorePrePlanPermissionModeIfNeeded?: () => void;
}

/** Result returned for programmatic sends (e.g. Agent Board task runs). User sends ignore it. */
export interface ProgrammaticSendResult {
  ok: boolean;
  finalAssistantContent: string;
  error?: string;
  /**
   * The turn was accepted but queued behind a still-streaming turn; it will run
   * (and stream its own end) once the current turn finishes. Distinguishes the
   * streaming-queue branch from a `void` return that means "not sent" (e.g. a
   * built-in command or a conversation switch), so callers can wait for queued
   * turns but fail fast on no-ops.
   */
  queued?: boolean;
}

export class InputController {
  private deps: InputControllerDeps;
  private activeResumeDropdown: ResumeSessionDropdown | null = null;
  private readonly queuedMessages: QueuedMessageController;
  private readonly inlinePrompts: InlinePromptController;
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  private pendingProviderUserMessages: Array<{
    displayContent: string;
    persistedContent?: string;
    currentNote?: string;
    images?: ChatMessage['images'];
  }> = [];
  private sawInitialProviderUserMessage = false;
  private awaitingProviderAssistantStart = false;
  /** Last dispatched turn, retained so a runtime-error card can re-dispatch it. */
  private lastTurnSubmission: {
    turnRequest: ChatTurnRequest;
    displayContent: string;
    images?: ChatMessage['images'];
  } | null = null;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
    this.queuedMessages = new QueuedMessageController({
      state: deps.state,
      getAgentService: () => this.getAgentService(),
      getActiveCapabilities: () => this.getActiveCapabilities(),
      getInputEl: deps.getInputEl,
      getImageContextManager: deps.getImageContextManager,
      getFileContextManager: deps.getFileContextManager,
      resetInputHeight: deps.resetInputHeight,
      requestSend: (options) => {
        void this.sendMessage(options);
      },
      onSteerCommitted: (message) => {
        this.pendingProviderUserMessages.push(message);
      },
    });
    this.inlinePrompts = new InlinePromptController({
      state: deps.state,
      getInputContainerEl: () => this.deps.getInputContainerEl(),
      renderContent: (el, markdown) => this.deps.renderer.renderContent(el, markdown),
      hideThinkingIndicator: () => this.deps.streamController.hideThinkingIndicator(),
      getPlanPathPrefix: () => this.getActiveCapabilities().planPathPrefix,
    });
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  private getAuxiliaryModel(): string | null {
    return this.deps.getAuxiliaryModel?.()
      ?? this.getAgentService()?.getAuxiliaryModel?.()
      ?? null;
  }

  private syncInstructionRefineModelOverride(
    instructionRefineService: InstructionRefineService,
  ): void {
    instructionRefineService.setModelOverride?.(this.getAuxiliaryModel() ?? undefined);
  }

  private getActiveProviderId(): ProviderId {
    const agentService = this.getAgentService();
    const conversationId = this.deps.state.currentConversationId;
    if (!conversationId) {
      return this.deps.getTabProviderId?.() ?? agentService?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    }

    if (agentService?.providerId) {
      return agentService.providerId;
    }

    return this.deps.plugin.getConversationSync(conversationId)?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
  }

  private getActiveCapabilities(): ProviderCapabilities {
    const providerId = this.getActiveProviderId();
    const agentService = this.getAgentService();
    if (agentService?.providerId === providerId) {
      return agentService.getCapabilities();
    }

    return ProviderRegistry.getCapabilities(providerId);
  }

  // ============================================
  // Message Sending
  // ============================================

  async sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
    content?: string;
    images?: ChatMessage['images'];
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<ProgrammaticSendResult | void> {
    const { state } = this.deps;

    // During conversation creation/switching/hydration, don't send - input is
    // preserved so the user can retry once the target conversation is ready.
    if (this.isConversationBusy()) return;

    const send = resolveComposerSend({
      inputEl: this.deps.getInputEl(),
      imageContextManager: this.deps.getImageContextManager(),
      fileContextManager: this.deps.getFileContextManager(),
      overrides: options,
    });
    if (!send.content && !send.hasImages) {
      if (!send.shouldUseInput) return { ok: false, finalAssistantContent: '', error: 'No content to send' };
      return;
    }

    // Check for built-in commands first (e.g., /clear, /new, /add-dir)
    const builtInCmd = detectBuiltInCommand(send.content);
    if (builtInCmd) {
      this.clearComposerInputIfUserSend(send);
      await this.executeBuiltInCommand(builtInCmd.command, builtInCmd.args);
      return;
    }

    // Persist any pasted/dropped images to the vault BEFORE the queue branch —
    // both the streaming-queue (state.queuedMessage) and the steer-then-commit
    // path reuse this image snapshot. Without persisting up front, queued or
    // steered images can land in ConversationStore.save with `data` cleared
    // and no `path` — leaving an unrenderable user bubble after reload.
    if (send.hasImages) {
      await this.persistComposerImages(send);
    }

    // If agent is working, queue the message instead of dropping it
    if (state.isStreaming) {
      return this.queueComposerSendWhileStreaming(send);
    }

    return this.dispatchComposerTurn(send, options);
  }

  private isConversationBusy(): boolean {
    const { state } = this.deps;
    return state.isCreatingConversation
      || state.isSwitchingConversation
      || state.isHydrating;
  }

  private clearComposerInputIfUserSend(send: ComposerSendContext): void {
    if (send.shouldUseInput) {
      send.inputEl.value = '';
      this.deps.resetInputHeight();
    }
  }

  private async persistComposerImages(send: ComposerSendContext): Promise<void> {
    const sourceImages = resolveComposerSourceImages(send);
    if (sourceImages.length > 0) {
      await persistPastedImages(this.deps.plugin.app, sourceImages, {
        logger: this.deps.plugin.logger.scope('chat.images'),
      });
    }
  }

  private queueComposerSendWhileStreaming(send: ComposerSendContext): ProgrammaticSendResult {
    const {
      state,
      selectionController,
      browserSelectionController,
      canvasSelectionController,
    } = this.deps;

    const images = send.hasImages ? [...resolveComposerSourceImages(send)] : undefined;
    const editorContext = selectionController.getContext();
    const browserContext = browserSelectionController?.getContext() ?? null;
    const canvasContext = canvasSelectionController.getContext();
    const { displayContent, turnRequest } = this.buildTurnSubmission({
      content: send.content,
      images,
      editorContextOverride: editorContext,
      browserContextOverride: browserContext,
      canvasContextOverride: canvasContext,
    });
    state.queuedMessage = this.queuedMessages.mergeQueuedMessages(
      state.queuedMessage,
      this.queuedMessages.createQueuedMessage(displayContent, turnRequest),
    );

    // Pill mentions were folded into the queued turnRequest above; clear them now
    // so they don't linger in the composer after the user hits send while streaming.
    send.fileContextManager?.clearAttachedPills();

    this.clearComposerInputIfUserSend(send);
    if (send.shouldUseInput) {
      send.imageContextManager?.clearImages();
    }
    this.queuedMessages.updateQueueIndicator();
    // Signal "accepted but queued" so programmatic callers (Agent Board
    // follow-ups) wait for the queued turn's stream end instead of mistaking
    // this for a not-sent no-op. User-driven sends ignore the return.
    return { ok: true, finalAssistantContent: '', queued: true };
  }

  private async dispatchComposerTurn(
    send: ComposerSendContext,
    options?: ComposerTurnOptions,
  ): Promise<ProgrammaticSendResult | void> {
    this.clearComposerInputIfUserSend(send);
    // Bug — selected work-order model didn't reach the runtime: capture the
    // tab-pinned model BEFORE `ensureServiceInitialized` runs, since the tab
    // lifecycle clears `draftModel` during init. Plumbed into `query()` as
    // `queryOptions.model` so the provider's per-turn override beats the
    // global `settings.model` snapshot.
    const tabModelOverride = normalizeTabModelOverride(this.deps.getTabModelOverride?.());
    const streamGeneration = beginStreamingTurnState(this.deps.state, send, this.deps);

    const outgoing = this.buildOutgoingTurn(send, options);
    const { userMsg, assistantMsg, deferredAiTitleGeneration } = await this.presentOutgoingTurn(outgoing);

    const agentService = await this.acquireTurnRuntime(deferredAiTitleGeneration);
    if (!agentService) return;

    await restoreResumeCheckpointIfNeeded(agentService, this.deps.state, this.deps.plugin);

    const ctx: DispatchedTurnContext = {
      agentService,
      send,
      turnRequest: outgoing.turnRequest,
      userMsg,
      assistantMsg,
      streamGeneration,
      tabModelOverride,
      deferredAiTitleGeneration,
    };

    let wasInterrupted = false;
    let wasInvalidated = false;
    // Set for programmatic (content-override) sends so callers like Agent Board can
    // observe the final assistant content. User-driven sends leave this undefined.
    let programmaticResult: ProgrammaticSendResult | undefined;
    try {
      const streamOutcome = await this.streamPreparedTurn(ctx);
      wasInterrupted = streamOutcome.wasInterrupted;
      wasInvalidated = streamOutcome.wasInvalidated;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.deps.streamController.appendText(`\n\n**Error:** ${errorMsg}`);
    } finally {
      programmaticResult = await this.finalizeTurn(ctx, { wasInterrupted, wasInvalidated });
    }

    return programmaticResult;
  }

  private buildOutgoingTurn(
    send: ComposerSendContext,
    options?: ComposerTurnOptions,
  ): OutgoingTurn {
    // Slash commands are passed directly to SDK for handling
    // SDK handles expansion, $ARGUMENTS, @file references, and frontmatter options.
    // Image persistence already ran above (covers queue + steer paths too).
    const images = resolveComposerSourceImages(send);
    const imagesForMessage = images.length > 0 ? [...images] : undefined;
    const isCompact = /^\/compact(\s|$)/i.test(send.content);

    // Only clear images if we consumed user input (not for programmatic content override)
    if (send.shouldUseInput) {
      send.imageContextManager?.clearImages();
    }

    const { displayContent, turnRequest } = this.resolveTurnSubmission(send, imagesForMessage, options);

    // Remember this turn so an actionable runtime-error card can re-dispatch it
    // verbatim via retryLastTurn() (UX-F/UX-J). Cloned so later mutation of the
    // live request can't change what a retry would re-send.
    this.lastTurnSubmission = {
      turnRequest: cloneChatTurnRequest(turnRequest),
      displayContent,
      images: imagesForMessage ? [...imagesForMessage] : undefined,
    };

    send.fileContextManager?.markCurrentNoteSent();
    // Added file/folder pills are consumed by this turn; clear them (keeps the current note).
    send.fileContextManager?.clearAttachedPills();

    return { displayContent, turnRequest, imagesForMessage, isCompact };
  }

  private resolveTurnSubmission(
    send: ComposerSendContext,
    imagesForMessage: ChatMessage['images'],
    options?: ComposerTurnOptions,
  ): { displayContent: string; turnRequest: ChatTurnRequest } {
    if (options?.turnRequestOverride) {
      return {
        displayContent: send.content,
        turnRequest: cloneChatTurnRequest(options.turnRequestOverride),
      };
    }
    return this.buildTurnSubmission({
      content: send.content,
      images: imagesForMessage,
      editorContextOverride: options?.editorContextOverride,
      browserContextOverride: options?.browserContextOverride,
      canvasContextOverride: options?.canvasContextOverride,
    });
  }

  private async presentOutgoingTurn(outgoing: OutgoingTurn): Promise<{
    userMsg: ChatMessage;
    assistantMsg: ChatMessage;
    deferredAiTitleGeneration: (() => void) | null;
  }> {
    const { state, renderer, streamController } = this.deps;
    const { displayContent, imagesForMessage, isCompact } = outgoing;

    const userMsg = createOutgoingUserMessage(this.deps.generateId(), displayContent, imagesForMessage);
    state.addMessage(userMsg);
    state.hasPendingConversationSave = true;
    renderer.addMessage(userMsg);

    const deferredAiTitleGeneration = await this.triggerTitleGeneration();

    const assistantMsg = createAssistantPlaceholderMessage(this.deps.generateId());
    state.addMessage(assistantMsg);
    this.activeStreamingAssistantMessage = assistantMsg;
    this.activateStreamingAssistantMessage(assistantMsg);
    this.pendingProviderUserMessages = [{
      displayContent,
      images: imagesForMessage,
    }];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = true;

    streamController.showThinkingIndicator(
      isCompact ? 'Compacting...' : undefined,
      isCompact ? 'claudian-thinking--compact' : undefined,
    );
    state.responseStartTime = performance.now();

    return { userMsg, assistantMsg, deferredAiTitleGeneration };
  }

  /** Lazy initialization: ensure service is ready before first query. */
  private async acquireTurnRuntime(
    deferredAiTitleGeneration: (() => void) | null,
  ): Promise<ChatRuntime | null> {
    const { state, streamController } = this.deps;
    if (this.deps.ensureServiceInitialized) {
      const ready = await this.deps.ensureServiceInitialized();
      if (!ready) {
        new Notice(t('chat.input.initFailed'));
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        this.activeStreamingAssistantMessage = null;
        this.resetProviderMessageBoundaryState();
        deferredAiTitleGeneration?.();
        return null;
      }
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      new Notice(t('chat.input.serviceUnavailable'));
      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
      deferredAiTitleGeneration?.();
      return null;
    }
    return agentService;
  }

  private async streamPreparedTurn(
    ctx: DispatchedTurnContext,
  ): Promise<{ wasInterrupted: boolean; wasInvalidated: boolean }> {
    const { state, renderer, streamController } = this.deps;
    let wasInterrupted = false;
    let wasInvalidated = false;

    const preparedTurn = ctx.agentService.prepareTurn(ctx.turnRequest);
    ctx.userMsg.content = preparedTurn.persistedContent;
    ctx.userMsg.currentNote = preparedTurn.isCompact
      ? undefined
      : preparedTurn.request.currentNotePath;
    // Re-render now that content carries folded @mentions, so the context card appears immediately.
    renderer.updateLiveUserMessage(ctx.userMsg);

    // Pass history WITHOUT current turn (userMsg + assistantMsg we just added)
    // This prevents duplication when rebuilding context for new sessions
    const previousMessages = state.messages.slice(0, -2);
    const queryOptions: ChatRuntimeQueryOptions = await this.resolveTurnQueryOptions(
      state.currentConversationId,
      ctx.tabModelOverride,
    );
    for await (const chunk of ctx.agentService.query(preparedTurn, previousMessages, queryOptions)) {
      if (state.streamGeneration !== ctx.streamGeneration) {
        wasInvalidated = true;
        break;
      }
      if (state.cancelRequested) {
        wasInterrupted = true;
        break;
      }

      if (await this.handleProviderMessageBoundaryChunk(chunk)) {
        continue;
      }

      await streamController.handleStreamChunk(
        chunk,
        this.activeStreamingAssistantMessage ?? ctx.assistantMsg,
      );
    }

    return { wasInterrupted, wasInvalidated };
  }

  /**
   * Builds per-turn ChatRuntimeQueryOptions, merging any bound-agent overrides
   * (prompt and model) into the base tab-model-override options. The builder's
   * precedence (explicit model > boundAgentModel > settings.model) ensures an
   * explicit tab/work-order model is never clobbered by the agent binding.
   */
  private async resolveTurnQueryOptions(
    conversationId: string | null,
    tabModelOverride: string | null | undefined,
  ): Promise<ChatRuntimeQueryOptions> {
    const base: ChatRuntimeQueryOptions = tabModelOverride ? { model: tabModelOverride } : {};

    if (!conversationId) {
      return base;
    }

    const conversation = await this.deps.plugin.getConversationById(conversationId);
    if (!conversation?.boundAgentId) {
      return base;
    }

    const projection = await this.deps.plugin.resolveBoundAgent?.(conversation.boundAgentId);
    if (!projection) {
      return base;
    }

    return {
      ...base,
      boundAgentPrompt: projection.prompt || undefined,
      boundAgentModel: projection.model || undefined,
    };
  }

  private async finalizeTurn(
    ctx: DispatchedTurnContext,
    flags: { wasInterrupted: boolean; wasInvalidated: boolean },
  ): Promise<ProgrammaticSendResult | undefined> {
    const { state } = this.deps;
    const finalAssistantMsg = this.activeStreamingAssistantMessage ?? ctx.assistantMsg;
    const turnMetadata = ctx.agentService.consumeTurnMetadata();
    ctx.userMsg.userMessageId = turnMetadata.userMessageId ?? ctx.userMsg.userMessageId;
    finalAssistantMsg.assistantMessageId = turnMetadata.assistantMessageId ?? finalAssistantMsg.assistantMessageId;

    // ALWAYS clear the timer interval, even on stream invalidation (prevents memory leaks)
    state.clearFlavorTimerInterval();

    let programmaticResult: ProgrammaticSendResult | undefined;
    // Skip remaining cleanup if stream was invalidated (tab closed or conversation switched)
    if (!flags.wasInvalidated && state.streamGeneration === ctx.streamGeneration) {
      programmaticResult = await this.completeFinishedTurn(ctx, {
        finalAssistantMsg,
        turnMetadata,
        didEnqueueToSdk: turnMetadata.wasSent === true,
        planCompleted: turnMetadata.planCompleted === true,
        wasInterrupted: flags.wasInterrupted,
      });
    }

    if (flags.wasInvalidated) {
      this.queuedMessages.clearPendingSteerState();
      this.queuedMessages.updateQueueIndicator();
    }

    this.activeStreamingAssistantMessage = null;
    this.resetProviderMessageBoundaryState();
    ctx.deferredAiTitleGeneration?.();
    return programmaticResult;
  }

  private async completeFinishedTurn(
    ctx: DispatchedTurnContext,
    turn: FinishedTurn,
  ): Promise<ProgrammaticSendResult | undefined> {
    const { plugin, state, streamController, conversationController } = this.deps;
    const { finalAssistantMsg } = turn;
    const didCancelThisTurn = turn.wasInterrupted || state.cancelRequested;
    if (didCancelThisTurn && !state.pendingNewSessionPlan) {
      await streamController.appendText('\n\n<span class="claudian-interrupted">Interrupted</span> <span class="claudian-interrupted-hint">· What should Claudian do instead?</span>');
    }
    streamController.hideThinkingIndicator();
    state.isStreaming = false;
    state.cancelRequested = false;
    this.queuedMessages.restorePendingSteerMessageToQueue();

    // Capture response duration before resetting state (skip for interrupted responses and compaction)
    bakeResponseDurationFooter(state, finalAssistantMsg, didCancelThisTurn);

    state.currentContentEl = null;

    await streamController.finalizeCurrentThinkingBlock(finalAssistantMsg);
    await streamController.finalizeCurrentTextBlock(finalAssistantMsg);
    this.deps.getSubagentManager().resetStreamingState();

    let programmaticResult: ProgrammaticSendResult | undefined;
    if (!ctx.send.shouldUseInput) {
      programmaticResult = didCancelThisTurn
        ? { ok: false, finalAssistantContent: finalAssistantMsg.content, error: 'Canceled' }
        : { ok: true, finalAssistantContent: finalAssistantMsg.content };
    }

    // Auto-hide completed todo panel on response end
    // Panel reappears only when new TodoWrite tool is called
    if (state.currentTodos && state.currentTodos.every(t => t.status === 'completed')) {
      state.currentTodos = null;
    }
    this.syncScrollToBottomAfterRenderUpdates();

    // approve-new-session: the tool_result chunk is dropped because cancelRequested
    // was set before the stream loop could process it — manually set the result so
    // the saved conversation renders correctly when revisited
    completeApprovedNewSessionPlanToolCalls(plugin.app, state, finalAssistantMsg);

    // Persist usage and message state BEFORE the plan-approval branches. This ensures
    // a cancelled stream still saves the last usage chunk; without this, cancellation
    // during the post-plan approval await (or any future invalidated branch) would
    // drop `state.usage` on the floor. updateLastResponse=false on cancel keeps the
    // partial assistant content from being claimed as a finished response, while
    // state.usage and message state still land in the meta file.
    // Only clear resumeAtMessageId if enqueue succeeded; preserve checkpoint on failure for retry.
    const saveExtras = turn.didEnqueueToSdk ? { resumeAtMessageId: undefined } : undefined;
    await conversationController.save(!didCancelThisTurn, saveExtras);

    await this.runPostTurnFollowUps(ctx, turn, didCancelThisTurn);
    return programmaticResult;
  }

  private async runPostTurnFollowUps(
    ctx: DispatchedTurnContext,
    turn: FinishedTurn,
    didCancelThisTurn: boolean,
  ): Promise<void> {
    const { state, renderer, conversationController } = this.deps;

    // Provider-agnostic post-plan approval: show UI and await decision before auto-send
    const approval = await this.resolvePlanApprovalOutcome(ctx, turn, didCancelThisTurn);
    if (approval.invalidated) return;

    // The leading save above already wrote message state and usage. Plan-approval
    // branches re-run sendMessage() (auto-implement / approve-new-session — both
    // call sendMessage which saves itself) or just update the input UI (revise /
    // cancel) — neither needs an extra save here.

    const userMsgIndex = state.messages.indexOf(ctx.userMsg);
    renderer.refreshActionButtons(ctx.userMsg, state.messages, userMsgIndex >= 0 ? userMsgIndex : undefined);
    // Surface the per-message work-order action on the just-completed agent response.
    renderer.refreshMessageActions(turn.finalAssistantMsg);

    // Auto-implement takes precedence over both approve-new-session and queued input
    if (approval.autoSendContent) {
      this.autoResumeWith(approval.autoSendContent);
    } else if (turn.turnMetadata.autoFollowUpText && !didCancelThisTurn && !turn.planCompleted) {
      // Cursor's one-shot AskUserQuestion answer, resumed as a follow-up — only when no plan
      // completed, since each plan-approval outcome owns it (implement merges, revise/cancel hold).
      this.autoResumeWith(turn.turnMetadata.autoFollowUpText);
    } else {
      // approve-new-session: create fresh conversation and send plan content
      // Must be inside the invalidation guard — if the tab was closed or
      // conversation switched, we must not create a new session on stale state.
      const planContent = state.pendingNewSessionPlan;
      if (planContent) {
        state.pendingNewSessionPlan = null;
        await conversationController.createNew();
        this.autoResumeWith(planContent);
      } else if (approval.shouldProcessQueuedMessage) {
        this.queuedMessages.processQueuedMessage();
      }
    }
  }

  private async resolvePlanApprovalOutcome(
    ctx: DispatchedTurnContext,
    turn: FinishedTurn,
    didCancelThisTurn: boolean,
  ): Promise<PlanApprovalOutcome> {
    if (!turn.planCompleted || didCancelThisTurn) {
      return { autoSendContent: null, invalidated: false, shouldProcessQueuedMessage: true };
    }

    const { decision, invalidated } = await this.inlinePrompts.showPlanApproval();

    // Re-check invalidation after async approval prompt
    if (this.deps.state.streamGeneration !== ctx.streamGeneration || invalidated) {
      return { autoSendContent: null, invalidated: true, shouldProcessQueuedMessage: true };
    }

    return applyPlanApprovalDecision(decision, turn.turnMetadata, this.deps);
  }

  /** Auto-sends `content` as the next (resumed) turn — shared by plan auto-implement,
   * approve-new-session, and Cursor's AskUserQuestion answer follow-up. */
  private autoResumeWith(content: string): void {
    this.deps.getInputEl().value = content;
    this.sendMessage().catch((err: unknown) => {
      this.deps.plugin.logger.scope('input').error('sendMessage failed unexpectedly', err);
    });
  }

  /** Whether a previously-dispatched turn is available to retry. */
  hasRetryableTurn(): boolean {
    return this.lastTurnSubmission !== null;
  }

  /**
   * Re-dispatches the last turn after a runtime error (UX-F/UX-J). Reuses the
   * normal {@link sendMessage} path via `turnRequestOverride`, so the retry runs
   * through the same prepare/query/stream plumbing — not a fabricated send path.
   * No-ops while streaming or when there is nothing to retry.
   */
  retryLastTurn(): void {
    const last = this.lastTurnSubmission;
    if (!last || this.deps.state.isStreaming) return;

    void this.sendMessage({
      content: last.displayContent,
      images: last.images,
      turnRequestOverride: last.turnRequest,
    }).catch((err: unknown) => {
      this.deps.plugin.logger.scope('input').error('retryLastTurn failed unexpectedly', err);
    });
  }

  // ============================================
  // Queue Management
  // ============================================
  //
  // The queued-message / steering state machine lives in QueuedMessageController.
  // These thin delegates preserve the public entry points other code calls
  // (StreamController, ConversationController, tab wiring, UI).

  updateQueueIndicator(): void {
    this.queuedMessages.updateQueueIndicator();
  }

  clearQueuedMessage(): void {
    this.queuedMessages.clearQueuedMessage();
  }

  private restorePendingMessagesToInput(): void {
    this.queuedMessages.restorePendingMessagesToInput();
  }

  private processQueuedMessage(): void {
    this.queuedMessages.processQueuedMessage();
  }

  private buildTurnSubmission(options: {
    content: string;
    images?: ChatMessage['images'];
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
  }): {
    displayContent: string;
    turnRequest: ChatTurnRequest;
  } {
    const {
      selectionController,
      browserSelectionController,
      canvasSelectionController,
    } = this.deps;

    const fileContextManager = this.deps.getFileContextManager();
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const externalContextSelector = this.deps.getExternalContextSelector();

    const currentNotePath = fileContextManager?.getCurrentNotePath() || null;
    const shouldSendCurrentNote = fileContextManager?.shouldSendCurrentNote(currentNotePath) ?? false;

    const editorContext = options.editorContextOverride !== undefined
      ? options.editorContextOverride
      : selectionController.getContext();
    const browserContext = options.browserContextOverride !== undefined
      ? options.browserContextOverride
      : (browserSelectionController?.getContext() ?? null);
    const canvasContext = options.canvasContextOverride !== undefined
      ? options.canvasContextOverride
      : canvasSelectionController.getContext();

    const externalContextPaths = externalContextSelector?.getExternalContexts();
    const isCompact = /^\/compact(\s|$)/i.test(options.content);
    // Fold pill mentions (attached files/folders) into the content sent to the provider.
    // getAttachedMentionSuffix() already excludes the current note; /compact must pass
    // through unchanged so the provider recognises its built-in command.
    const mentionSuffix = !isCompact && fileContextManager
      ? fileContextManager.getAttachedMentionSuffix()
      : '';
    const foldedContent = options.content + mentionSuffix;
    const transformedText = !isCompact && fileContextManager
      ? fileContextManager.transformContextMentions(foldedContent)
      : options.content;
    const enabledMcpServers = mcpServerSelector?.getEnabledServers();


    return {
      displayContent: options.content,
      turnRequest: {
        text: transformedText,
        images: options.images,
        currentNotePath: shouldSendCurrentNote && currentNotePath ? currentNotePath : undefined,
        editorSelection: editorContext,
        browserSelection: browserContext,
        canvasSelection: canvasContext,
        externalContextPaths: externalContextPaths && externalContextPaths.length > 0
          ? externalContextPaths
          : undefined,
        enabledMcpServers: enabledMcpServers && enabledMcpServers.size > 0
          ? enabledMcpServers
          : undefined,
      },
    };
  }

  private activateStreamingAssistantMessage(message: ChatMessage): void {
    const { state, renderer } = this.deps;
    const msgEl = renderer.addMessage(message);
    const contentEl = msgEl.querySelector<HTMLElement>('.claudian-message-content');

    if (!contentEl) {
      return;
    }

    if (!state.currentContentEl) {
      state.toolCallElements.clear();
    }

    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  private resetProviderMessageBoundaryState(): void {
    this.pendingProviderUserMessages = [];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = false;
  }

  private async handleProviderMessageBoundaryChunk(chunk: StreamChunk): Promise<boolean> {
    switch (chunk.type) {
      case 'user_message_start':
        await this.handleProviderUserMessageStart(chunk);
        return true;
      case 'assistant_message_start':
        await this.handleProviderAssistantMessageStart();
        return true;
      default:
        return false;
    }
  }

  private async handleProviderUserMessageStart(
    chunk: Extract<StreamChunk, { type: 'user_message_start' }>,
  ): Promise<void> {
    const expected = this.pendingProviderUserMessages.shift();
    if (!this.sawInitialProviderUserMessage) {
      this.sawInitialProviderUserMessage = true;
      return;
    }

    this.queuedMessages.clearPendingSteerState();
    this.queuedMessages.updateQueueIndicator();

    const previousAssistant = this.activeStreamingAssistantMessage;
    const shouldDiscardPlaceholder = this.shouldDiscardPendingAssistantPlaceholder(previousAssistant);
    if (previousAssistant) {
      if (shouldDiscardPlaceholder) {
        this.discardStreamingAssistantMessage(previousAssistant.id);
      } else {
        await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
        await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
      }
    }
    this.deps.streamController.hideThinkingIndicator();

    const displayContent = expected?.displayContent ?? chunk.content;
    const persistedContent = expected?.persistedContent ?? displayContent;
    const images = expected?.images;
    if (displayContent || (images?.length ?? 0) > 0) {
      const userMessage: ChatMessage = {
        id: this.deps.generateId(),
        role: 'user',
        content: persistedContent,
        displayContent,
        timestamp: Date.now(),
        currentNote: expected?.currentNote,
        images,
      };
      this.deps.state.addMessage(userMessage);
      this.deps.renderer.addMessage(userMessage);
    }

    const assistantMessage = createAssistantPlaceholderMessage(this.deps.generateId());
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
    this.deps.state.responseStartTime = performance.now();
    this.awaitingProviderAssistantStart = true;
  }

  private async handleProviderAssistantMessageStart(): Promise<void> {
    if (this.awaitingProviderAssistantStart) {
      this.awaitingProviderAssistantStart = false;
      return;
    }

    const previousAssistant = this.activeStreamingAssistantMessage;
    if (previousAssistant) {
      await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
      await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
    }

    const assistantMessage = createAssistantPlaceholderMessage(this.deps.generateId());
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
  }

  private shouldDiscardPendingAssistantPlaceholder(message: ChatMessage | null): boolean {
    return this.awaitingProviderAssistantStart
      && !!message
      && !message.content.trim()
      && (message.toolCalls?.length ?? 0) === 0
      && (message.contentBlocks?.length ?? 0) === 0;
  }

  private discardStreamingAssistantMessage(messageId: string): void {
    const { state, renderer } = this.deps;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    renderer.removeMessage(messageId);
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  // ============================================
  // Title Generation
  // ============================================

  /**
   * Triggers AI title generation after first user message.
   * Handles setting fallback title, firing async generation, and updating UI.
   */
  private async triggerTitleGeneration(): Promise<(() => void) | null> {
    const { plugin, state, conversationController } = this.deps;

    if (state.messages.length !== 1) {
      return null;
    }

    if (!state.currentConversationId) {
      const sessionId = this.getAgentService()?.getSessionId() ?? undefined;
      const boundAgentId = this.deps.getBoundAgentId?.() ?? undefined;
      const conversation = await plugin.createConversation({
        providerId: this.getActiveProviderId(),
        sessionId,
        boundAgentId,
      });
      state.currentConversationId = conversation.id;
    }

    // Find first user message by role (not by index)
    const firstUserMsg = state.messages.find(m => m.role === 'user');

    if (!firstUserMsg) {
      return null;
    }

    const userContent = firstUserMsg.displayContent || firstUserMsg.content;

    // Set immediate fallback title
    const fallbackTitle = conversationController.generateFallbackTitle(userContent);
    await plugin.renameConversation(state.currentConversationId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return null;
    }

    // Fire async AI title generation only if service available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      // No titleService, just keep the fallback title with no status
      return null;
    }

    // Mark as pending only when we're actually starting generation
    await plugin.updateConversation(state.currentConversationId, { titleGenerationStatus: 'pending' });
    conversationController.updateHistoryDropdown();

    const convId = state.currentConversationId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    return () => {
      titleService.generateTitle(
        convId,
        userContent,
        async (conversationId, result) => {
          // Check if conversation still exists and user hasn't manually renamed
          const currentConv = await plugin.getConversationById(conversationId);
          if (!currentConv) return;

          // Only apply AI title if user hasn't manually renamed (title still matches fallback)
          const userManuallyRenamed = currentConv.title !== expectedTitle;

          if (result.success && !userManuallyRenamed) {
            await plugin.renameConversation(conversationId, result.title);
            await plugin.updateConversation(conversationId, { titleGenerationStatus: 'success' });
          } else if (!userManuallyRenamed) {
            // Keep fallback title, mark as failed (only if user hasn't renamed)
            await plugin.updateConversation(conversationId, { titleGenerationStatus: 'failed' });
          } else {
            // User manually renamed, clear the status (user's choice takes precedence)
            await plugin.updateConversation(conversationId, { titleGenerationStatus: undefined });
          }
          conversationController.updateHistoryDropdown();
        },
      ).catch(() => {
        // Silently ignore title generation errors
      });
    };
  }

  // ============================================
  // Streaming Control
  // ============================================

  cancelStreaming(): void {
    const { state, streamController } = this.deps;
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    // Restore queued message to input instead of discarding
    this.restorePendingMessagesToInput();
    this.getAgentService()?.cancel();
    streamController.hideThinkingIndicator();
  }

  private syncScrollToBottomAfterRenderUpdates(): void {
    const { plugin, state } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    window.requestAnimationFrame(() => {
      if (!(this.deps.plugin.settings.enableAutoScroll ?? true)) return;
      if (!this.deps.state.autoScrollEnabled) return;

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // ============================================
  // Instruction Mode
  // ============================================

  async handleInstructionSubmit(rawInstruction: string): Promise<void> {
    const { plugin } = this.deps;

    const instructionRefineService = this.deps.getInstructionRefineService();
    const instructionModeManager = this.deps.getInstructionModeManager();

    if (!instructionRefineService) return;

    const existingPrompt = plugin.settings.systemPrompt;
    let modal: InstructionModal | null = null;
    let wasCancelled = false;

    try {
      modal = new InstructionModal(
        plugin.app,
        rawInstruction,
        {
          onAccept: (finalInstruction) => {
            void (async (): Promise<void> => {
              const currentPrompt = plugin.settings.systemPrompt;
              plugin.settings.systemPrompt = appendMarkdownSnippet(currentPrompt, finalInstruction);
              await plugin.saveSettings();

              new Notice(t('chat.input.instructionAdded'));
              instructionModeManager?.clear();
            })();
          },
          onReject: () => {
            wasCancelled = true;
            instructionRefineService.cancel();
            instructionModeManager?.clear();
          },
          onClarificationSubmit: async (response) => {
            this.syncInstructionRefineModelOverride(instructionRefineService);
            const result = await instructionRefineService.continueConversation(response);

            if (wasCancelled) {
              return;
            }

            if (!result.success) {
              if (result.error === 'Cancelled') {
                return;
              }
              new Notice(result.error || t('chat.input.processResponseFailed'));
              modal?.showError(result.error || 'Failed to process response');
              return;
            }

            if (result.clarification) {
              modal?.showClarification(result.clarification);
            } else if (result.refinedInstruction) {
              modal?.showConfirmation(result.refinedInstruction);
            }
          }
        }
      );
      modal.open();

      this.syncInstructionRefineModelOverride(instructionRefineService);
      instructionRefineService.resetConversation();
      const result = await instructionRefineService.refineInstruction(
        rawInstruction,
        existingPrompt
      );

      if (wasCancelled) {
        return;
      }

      if (!result.success) {
        if (result.error === 'Cancelled') {
          instructionModeManager?.clear();
          return;
        }
        new Notice(result.error || t('chat.input.refineFailed'));
        modal.showError(result.error || 'Failed to refine instruction');
        instructionModeManager?.clear();
        return;
      }

      if (result.clarification) {
        modal.showClarification(result.clarification);
      } else if (result.refinedInstruction) {
        modal.showConfirmation(result.refinedInstruction);
      } else {
        new Notice(t('chat.input.noInstruction'));
        modal.showError('No instruction received');
        instructionModeManager?.clear();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      new Notice(t('common.errorWithDetail', { error: errorMsg }));
      modal?.showError(errorMsg);
      instructionModeManager?.clear();
    }
  }

  // ============================================
  // Approval Dialogs
  // ============================================

  handleApprovalRequest(
    toolName: string,
    input: Record<string, unknown>,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
  ): Promise<ApprovalDecision> {
    return this.inlinePrompts.handleApprovalRequest(toolName, input, description, approvalOptions);
  }

  handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    return this.inlinePrompts.handleAskUserQuestion(input, signal);
  }

  handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    return this.inlinePrompts.handleExitPlanMode(input, signal);
  }

  dismissPendingApprovalPrompt(): void {
    this.inlinePrompts.dismissPendingApprovalPrompt();
  }

  dismissPendingApproval(): void {
    this.inlinePrompts.dismissPendingApproval();
  }

  // ============================================
  // Built-in Commands
  // ============================================

  private async executeBuiltInCommand(command: BuiltInCommand, args: string): Promise<void> {
    const { conversationController } = this.deps;
    const capabilities = this.getActiveCapabilities();

    if (!isBuiltInCommandSupported(command, capabilities)) {
      new Notice(t('chat.input.commandUnsupported', { command: command.name }));
      return;
    }

    switch (command.action) {
      case 'clear':
        await conversationController.createNew();
        break;
      case 'add-dir': {
        const externalContextSelector = this.deps.getExternalContextSelector();
        if (!externalContextSelector) {
          new Notice(t('chat.input.externalContextUnavailable'));
          return;
        }
        const result = externalContextSelector.addExternalContext(args);
        if (result.success) {
          new Notice(t('chat.input.externalContextAdded', { path: result.normalizedPath }));
        } else {
          new Notice(result.error);
        }
        break;
      }
      case 'resume':
        this.showResumeDropdown();
        break;
      case 'fork': {
        if (!this.getActiveCapabilities().supportsFork) {
          new Notice(t('chat.input.forkUnsupported'));
          return;
        }
        if (!this.deps.onForkAll) {
          new Notice(t('chat.input.forkUnavailable'));
          return;
        }
        await this.deps.onForkAll();
        break;
      }
      default: {
        // Unknown command - notify user
        const unknownAction = typeof (command as { action?: unknown }).action === 'string'
          ? (command as { action: string }).action
          : 'unknown';
        new Notice(t('chat.input.unknownCommand', { command: unknownAction }));
        break;
      }
    }
  }

  // ============================================
  // Resume Session Dropdown
  // ============================================

  handleResumeKeydown(e: KeyboardEvent): boolean {
    if (!this.activeResumeDropdown?.isVisible()) return false;
    return this.activeResumeDropdown.handleKeydown(e);
  }

  isResumeDropdownVisible(): boolean {
    return this.activeResumeDropdown?.isVisible() ?? false;
  }

  destroyResumeDropdown(): void {
    if (this.activeResumeDropdown) {
      this.activeResumeDropdown.destroy();
      this.activeResumeDropdown = null;
    }
  }

  private showResumeDropdown(): void {
    const { plugin, state, conversationController } = this.deps;

    // Clean up any existing dropdown
    this.destroyResumeDropdown();

    const conversations = plugin.getConversationList();
    if (conversations.length === 0) {
      new Notice(t('chat.input.noConversationsToResume'));
      return;
    }

    const openConversation = this.deps.openConversation
      ?? ((id: string) => conversationController.switchTo(id));

    this.activeResumeDropdown = new ResumeSessionDropdown(
      this.deps.getInputContainerEl(),
      this.deps.getInputEl(),
      conversations,
      state.currentConversationId,
      {
        onSelect: (id) => {
          this.destroyResumeDropdown();
          openConversation(id).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(t('chat.input.openConversationFailed', { error: msg }));
          });
        },
        onDismiss: () => {
          this.destroyResumeDropdown();
        },
      }
    );
  }
}
