import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type ProviderId,
  type ProviderSubagentLifecycleAdapter,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import { parseTodoInput } from '../../../core/tools/todo';
import { extractResolvedAnswers, extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import {
  isWriteEditTool,
  skipsBlockedDetection,
  TOOL_ASK_USER_QUESTION,
  TOOL_TODO_WRITE,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { ChatMessage, StreamChunk, SubagentInfo, ToolCallInfo } from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import type ClaudianPlugin from '../../../main';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
  scheduleDelayedFrame,
} from '../../../utils/animationFrame';
import { extractDiffData } from '../../../utils/diff';
import { toVaultRelativeOpenPath } from '../../../utils/fileLink';
import { hasStreamingMathDelimiters } from '../../../utils/markdownMath';
import { openClaudianProviderSettings } from '../../../utils/obsidianPrivateApi';
import { renderInlineRuntimeError } from '../rendering/InlineRuntimeError';
import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import { scrollMessagesToBottom } from '../rendering/scrollToBottom';
import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import {
  createThinkingBlock,
  finalizeThinkingBlock,
} from '../rendering/ThinkingBlockRenderer';
import {
  isBlockedToolResult,
  renderToolCall,
  updateToolCallResult,
} from '../rendering/ToolCallRenderer';
import {
  createWriteEditBlock,
  finalizeWriteEditBlock,
  updateWriteEditWithDiff,
} from '../rendering/WriteEditRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import { collectEditedPathsFromToolCall, collectRemovedPathsFromToolCall } from '../utils/editedFiles';
import { ProviderLifecycleSubagentCoordinator } from './ProviderLifecycleSubagentCoordinator';
import { classifyRuntimeError } from './runtimeErrorClassification';
import { StreamingIndicator } from './streamingIndicator';
import {
  type BlockTransitionDecision,
  projectBlockTransition,
  projectCompactBoundary,
  type ProjectionBlockState,
  projectNoticeText,
  projectUsage,
} from './StreamProjection';
import { SubagentStreamCoordinator } from './SubagentStreamCoordinator';
import {
  appendToolCallToMessage,
  createRunningToolCall,
  updateRenderedToolCallHeader,
} from './toolCallAppend';
import { ToolCallIndex } from './toolCallIndex';
import { notifyVaultForToolResult } from './vaultFileNotifier';

export interface StreamControllerDeps {
  plugin: ClaudianPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  updateQueueIndicator: () => void;
  /** Get the agent service from the tab. */
  getAgentService?: () => ChatRuntime | null;
  /**
   * Re-dispatches the last turn for the active conversation. Wired to the retry
   * affordance on actionable runtime-error cards (UX-F/UX-J). Omitted when the
   * tab has no turn available to retry.
   */
  onRetryLastTurn?: () => void;
}

export class StreamController {
  // Size-aware streaming backoff (PERF-3): streaming render is NOT a delta append —
  // each throttled tick re-parses the entire accumulated block, so cost is O(C) per
  // tick (O(C²) cumulative as the block grows). Below the threshold we re-render every
  // frame for snappy feedback; past it we coalesce continuation renders behind a delay
  // to cap the re-parse rate. The final render is always exact because finalize flushes
  // synchronously. Delta-append rendering is deliberately deferred unless users report
  // jank on very long single answers (docs/issues/streaming-render-cost.md).
  private static readonly STREAM_REPARSE_BACKOFF_THRESHOLD_CHARS = 4096;
  private static readonly STREAM_REPARSE_BACKOFF_MS = 200;

  private deps: StreamControllerDeps;
  private pendingTextRenderFrame: ScheduledAnimationFrame | null = null;
  private pendingTextRenderPromise: Promise<void> | null = null;
  private resolvePendingTextRender: (() => void) | null = null;
  private isTextRenderRunning = false;
  // Collapse setting snapshotted once when the current text block starts. Read
  // (not re-evaluated) through the block's append/render/finalize lifecycle so a
  // mid-block toggle can't race those steps; the toggle takes effect next block.
  private currentTextBlockCollapsed = false;
  private pendingThinkingRenderFrame: ScheduledAnimationFrame | null = null;
  private pendingThinkingRenderPromise: Promise<void> | null = null;
  private resolvePendingThinkingRender: (() => void) | null = null;
  private isThinkingRenderRunning = false;
  private pendingToolOutputFrames = new Map<string, ScheduledAnimationFrame>();
  private pendingScrollFrame: ScheduledAnimationFrame | null = null;

  // O(1) tool-call lookup accelerator for the streaming hot path (avoids
  // per-chunk linear scans over a turn's accumulated tool calls). Lazily kept
  // in sync per message; always backed by the authoritative `msg.toolCalls`.
  private toolCallIndex = new ToolCallIndex();
  private indexedToolCallsMsg: ChatMessage | null = null;
  private indexedToolCallsCount = 0;

  // External observers of the neutral chunk stream (e.g. the work-order runner),
  // notified before normal processing so a card can mirror the live run.
  private streamObservers = new Set<(chunk: StreamChunk) => void>();
  /** True while replaying an auto-triggered (background) turn — see {@link setRenderingAutoTurn}. */
  private renderingAutoTurn = false;

  private readonly indicator: StreamingIndicator;
  private readonly subagents: SubagentStreamCoordinator;
  private readonly lifecycleSubagents: ProviderLifecycleSubagentCoordinator;

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
    this.indicator = new StreamingIndicator({
      state: deps.state,
      getMessagesEl: deps.getMessagesEl,
      updateQueueIndicator: deps.updateQueueIndicator,
    });
    this.subagents = new SubagentStreamCoordinator({
      state: deps.state,
      subagentManager: deps.subagentManager,
      getAgentService: deps.getAgentService,
      findToolCall: (msg, id) => this.findToolCall(msg, id),
      normalizeToolResultContent: (content) => this.normalizeToolResultContent(content),
      flushPendingTools: () => this.flushPendingTools(),
      showThinkingIndicator: () => this.showThinkingIndicator(),
      scrollToBottom: () => this.scrollToBottom(),
      recordEditedFiles: (toolCall) => {
        notifyVaultForToolResult(this.deps.plugin.app, toolCall);
        this.recordEditedFiles(toolCall);
      },
    });
    this.lifecycleSubagents = new ProviderLifecycleSubagentCoordinator({
      plugin: deps.plugin,
      state: deps.state,
      findToolCall: (msg, id) => this.findToolCall(msg, id),
      normalizeToolResultContent: (content) => this.normalizeToolResultContent(content),
      getSubagentLifecycleAdapter: (toolName) => this.getSubagentLifecycleAdapter(toolName),
      flushPendingTools: () => this.flushPendingTools(),
    });
  }

  /**
   * Marks the controller as rendering an auto-triggered background turn (e.g. a
   * task-notification response replayed through this same controller). Such a
   * turn has no user prompt behind it, so a runtime-error card must suppress its
   * Retry affordance rather than re-dispatch the unrelated last chat turn. Set
   * around the auto-turn chunk loop and cleared in its `finally`.
   */
  setRenderingAutoTurn(active: boolean): void {
    this.renderingAutoTurn = active;
  }

  /**
   * Registers an observer that receives every neutral {@link StreamChunk} this
   * controller handles, for the lifetime of the returned disposer. Observer
   * errors are isolated so a faulty observer never breaks streaming.
   */
  addStreamObserver(observer: (chunk: StreamChunk) => void): () => void {
    this.streamObservers.add(observer);
    return () => {
      this.streamObservers.delete(observer);
    };
  }

  /**
   * Resolves a tool call by id in O(1). Lazily reindexes when the active
   * message changes and tail-indexes newly appended tool calls, so the cost is
   * amortized constant. Falls back to a linear scan via {@link ToolCallIndex},
   * keeping results correct regardless of index state.
   */
  private findToolCall(msg: ChatMessage, id: string): ToolCallInfo | undefined {
    const toolCalls = msg.toolCalls;
    const count = toolCalls?.length ?? 0;
    if (this.indexedToolCallsMsg !== msg) {
      this.toolCallIndex.reindex(toolCalls);
      this.indexedToolCallsMsg = msg;
      this.indexedToolCallsCount = count;
    } else if (count > this.indexedToolCallsCount) {
      for (let i = this.indexedToolCallsCount; i < count; i++) {
        this.toolCallIndex.add(toolCalls![i]);
      }
      this.indexedToolCallsCount = count;
    }
    return this.toolCallIndex.get(id, toolCalls);
  }


  private getActiveProviderId(): ProviderId {
    return this.deps.getAgentService?.()?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
  }

  private getSubagentLifecycleAdapter(toolName?: string): ProviderSubagentLifecycleAdapter | null {
    return resolveSubagentLifecycleAdapter(this.getActiveProviderId(), toolName);
  }

  private normalizeToolResultContent(content: unknown): string {
    return extractToolResultContent(content, { fallbackIndent: 2 });
  }

  // ============================================
  // Stream Chunk Handling
  // ============================================

  async handleStreamChunk(chunk: StreamChunk, msg: ChatMessage): Promise<void> {
    this.notifyStreamObservers(chunk);
    if (!(await this.routeContentChunk(chunk, msg))) {
      await this.routeLifecycleChunk(chunk, msg);
    }
    this.scrollToBottom();
  }

  /** Handles content/tool stream chunks. Returns false if `chunk` is not a content chunk. */
  private async routeContentChunk(chunk: StreamChunk, msg: ChatMessage): Promise<boolean> {
    switch (chunk.type) {
      case 'thinking':
        await this.applyBlockTransition(projectBlockTransition('thinking', this.blockState()), msg);
        await this.appendThinking(chunk.content);
        return true;

      case 'text':
        await this.applyBlockTransition(projectBlockTransition('text', this.blockState()), msg);
        msg.content += chunk.content;
        await this.appendText(chunk.content);
        return true;

      case 'tool_use':
        await this.applyBlockTransition(projectBlockTransition('tool_use', this.blockState()), msg);
        this.dispatchToolUseChunk(chunk, msg);
        return true;

      case 'tool_result':
        await this.handleToolResult(chunk, msg);
        return true;

      case 'subagent_tool_use':
      case 'subagent_tool_result':
        await this.subagents.handleSubagentChunk(chunk, msg);
        return true;

      case 'async_subagent_result':
        await this.subagents.handleAsyncSubagentResult(chunk);
        return true;

      case 'tool_output':
        this.handleToolOutput(chunk, msg);
        return true;

      default:
        return false;
    }
  }

  /** Handles turn-lifecycle stream chunks (notice/error/done/compaction/usage). */
  private async routeLifecycleChunk(chunk: StreamChunk, msg: ChatMessage): Promise<void> {
    switch (chunk.type) {
      case 'notice':
        this.flushPendingTools();
        await this.appendText(projectNoticeText(chunk));
        break;

      case 'error':
        await this.handleErrorChunk(chunk, msg);
        break;

      case 'done':
        // Flush any remaining pending tools
        this.flushPendingTools();
        await this.finalizeCurrentTextBlock(msg);
        break;

      case 'context_compacted':
        await this.handleContextCompactedChunk(msg);
        break;

      case 'usage':
        this.handleUsageChunk(chunk);
        break;

      default:
        break;
    }
  }

  private async handleContextCompactedChunk(msg: ChatMessage): Promise<void> {
    await this.applyBlockTransition(projectCompactBoundary(this.blockState()), msg);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'context_compacted' });
    this.renderCompactBoundary();
  }

  private handleUsageChunk(chunk: Extract<StreamChunk, { type: 'usage' }>): void {
    const { state } = this.deps;
    const decision = projectUsage(chunk, {
      currentSessionId: this.deps.getAgentService?.()?.getSessionId() ?? null,
      subagentsSpawnedThisStream: this.deps.subagentManager.subagentsSpawnedThisStream,
      ignoreUsageUpdates: state.ignoreUsageUpdates,
      activeProviderModel: this.getActiveProviderModel(),
    });
    if (decision.action === 'update') {
      state.usage = decision.usage;
    }
  }

  /** Fans the neutral chunk out to registered observers; an observer error never breaks the stream. */
  private notifyStreamObservers(chunk: StreamChunk): void {
    if (this.streamObservers.size === 0) return;
    for (const observer of this.streamObservers) {
      try {
        observer(chunk);
      } catch {
        // An observer must never break the stream for the chat UI.
      }
    }
  }

  /** Current open-block snapshot the projection's block-transition decisions read. */
  private blockState(): ProjectionBlockState {
    const { state } = this.deps;
    return {
      hasOpenTextBlock: state.currentTextEl !== null,
      hasOpenThinkingBlock: state.currentThinkingState !== null,
    };
  }

  /** Applies a projection block-transition decision through the existing finalize/flush paths. */
  private async applyBlockTransition(
    decision: BlockTransitionDecision,
    msg: ChatMessage,
  ): Promise<void> {
    if (decision.flushPendingTools) {
      this.flushPendingTools();
    }
    if (decision.finalizeThinking) {
      await this.finalizeCurrentThinkingBlock(msg);
    }
    if (decision.finalizeText) {
      await this.finalizeCurrentTextBlock(msg);
    }
  }

  /** Routes a tool_use chunk to its specialized handler (subagent / output / lifecycle / regular). */
  private dispatchToolUseChunk(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
  ): void {
    if (this.subagents.dispatchToolUse(chunk, msg)) {
      return;
    }
    if (this.lifecycleSubagents.dispatchToolUse(chunk, msg)) {
      return;
    }

    this.handleRegularToolUse(chunk, msg);
  }

  // Finalizes open thinking + text blocks before the error card so the persisted
  // block order matches the live DOM (thinking → text → error) on reload, then
  // persists a structured block and renders an actionable recovery card.
  private async handleErrorChunk(
    chunk: { type: 'error'; content: string },
    msg: ChatMessage,
  ): Promise<void> {
    this.flushPendingTools();
    await this.finalizeCurrentThinkingBlock(msg);
    await this.finalizeCurrentTextBlock(msg);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'runtime_error', content: chunk.content });
    this.renderRuntimeError(chunk.content);
  }

  // ============================================
  // Tool Use Handling
  // ============================================

  /**
   * Handles regular tool_use chunks by buffering them.
   * Tools are rendered when flushPendingTools is called (on next content type or tool_result).
   */
  private handleRegularToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state } = this.deps;

    // Check if this is an update to an existing tool call
    const existingToolCall = this.findToolCall(msg, chunk.id);
    if (existingToolCall) {
      this.mergeExistingToolCallInput(existingToolCall, chunk.input, chunk.id);
      return;
    }

    // Create new tool call
    const toolCall = createRunningToolCall(chunk);
    appendToolCallToMessage(msg, toolCall);

    // Apply panel/plan side effects immediately, but still buffer the render
    this.applyToolInputSideEffects(chunk.name, chunk.input);

    // Buffer the tool call instead of rendering immediately
    if (state.currentContentEl) {
      state.pendingTools.set(chunk.id, {
        toolCall,
        parentEl: state.currentContentEl,
      });
      this.showThinkingIndicator();
    }
  }

  /**
   * Merges a later tool_use chunk's input into an existing tool call, applies the
   * same panel/plan side effects as a fresh tool, and refreshes the rendered
   * header if the block is already on screen. If still pending, the merged input
   * is already on the toolCall object and gets picked up at render time.
   */
  private mergeExistingToolCallInput(
    existingToolCall: ToolCallInfo,
    chunkInput: Record<string, unknown>,
    toolId: string,
  ): void {
    const newInput = chunkInput || {};
    if (Object.keys(newInput).length === 0) return;

    existingToolCall.input = { ...existingToolCall.input, ...newInput };

    // Re-run side effects on input updates (streaming may complete the input)
    this.applyToolInputSideEffects(existingToolCall.name, existingToolCall.input);

    const toolEl = this.deps.state.toolCallElements.get(toolId);
    if (toolEl) {
      updateRenderedToolCallHeader(
        this.deps.plugin.app,
        toolEl,
        existingToolCall.name,
        existingToolCall.input,
      );
    }
  }

  /**
   * Applies the immediate, render-independent side effects of a tool's input:
   * updating the todo panel for TodoWrite and capturing the plan file path for
   * Writes into the provider plan directory.
   */
  private applyToolInputSideEffects(name: string, input: Record<string, unknown>): void {
    if (name === TOOL_TODO_WRITE) {
      const todos = parseTodoInput(input);
      if (todos) {
        this.deps.state.currentTodos = todos;
      }
    }
    if (name === TOOL_WRITE) {
      this.capturePlanFilePath(input);
    }
  }

  private getActiveProviderModel(): string | undefined {
    const providerId = this.deps.getAgentService?.()?.providerId;
    if (!providerId) {
      return undefined;
    }

    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.deps.plugin.settings,
      providerId,
    );
    return typeof settings.model === 'string' ? settings.model : undefined;
  }

  private shouldDeferMathRendering(): boolean {
    return this.deps.plugin.settings.deferMathRenderingDuringStreaming !== false;
  }

  private shouldCollapseStreamingResponse(): boolean {
    return this.deps.plugin.settings.collapseStreamingResponse !== false;
  }

  private getStreamingRenderOptions(content: string): RenderContentOptions | undefined {
    return this.shouldDeferMathRendering() && hasStreamingMathDelimiters(content)
      ? { deferMath: true }
      : undefined;
  }

  private capturePlanFilePath(input: Record<string, unknown>): void {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return;

    const planPathPrefix = this.deps.getAgentService?.()?.getCapabilities().planPathPrefix;
    if (planPathPrefix && filePath.replace(/\\/g, '/').includes(planPathPrefix)) {
      this.deps.state.planFilePath = filePath;
    }
  }

  /**
   * Flushes all pending tool calls by rendering them.
   * Called when a different content type arrives or stream ends.
   */
  private flushPendingTools(): void {
    const { state } = this.deps;

    if (state.pendingTools.size === 0) {
      return;
    }

    // Render pending tools in order (Map preserves insertion order)
    for (const toolId of state.pendingTools.keys()) {
      this.renderPendingTool(toolId);
    }

    state.pendingTools.clear();
  }

  /**
   * Renders a single pending tool call and moves it from pending to rendered state.
   */
  private renderPendingTool(toolId: string): void {
    const { state } = this.deps;
    const pending = state.pendingTools.get(toolId);
    if (!pending) return;

    const { toolCall, parentEl } = pending;
    if (!parentEl) return;
    if (isWriteEditTool(toolCall.name)) {
      const writeEditState = createWriteEditBlock(this.deps.plugin.app, parentEl, toolCall, { initiallyExpanded: this.deps.plugin.settings.expandFileEditsByDefault === true });
      state.writeEditStates.set(toolId, writeEditState);
      state.toolCallElements.set(toolId, writeEditState.wrapperEl);
    } else {
      renderToolCall(this.deps.plugin.app, parentEl, toolCall, state.toolCallElements);
    }
    state.pendingTools.delete(toolId);
  }

  private handleToolOutput(
    chunk: { type: 'tool_output'; id: string; content: string },
    msg: ChatMessage,
  ): void {
    const { state } = this.deps;

    if (state.pendingTools.has(chunk.id)) {
      this.renderPendingTool(chunk.id);
    }

    const existingToolCall = this.findToolCall(msg, chunk.id);
    if (!existingToolCall) {
      return;
    }

    existingToolCall.result = (existingToolCall.result ?? '') + chunk.content;
    this.scheduleToolOutputRender(chunk.id, existingToolCall);
    this.showThinkingIndicator();
  }

  private async handleToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult },
    msg: ChatMessage
  ): Promise<void> {
    const { state } = this.deps;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    if (await this.subagents.handleToolResult(chunk, msg)) {
      return;
    }

    if (this.lifecycleSubagents.handleProviderSubagentResult(chunk, msg)) {
      this.showThinkingIndicator();
      return;
    }

    // Check if tool is still pending (buffered) - render it now before applying result
    if (state.pendingTools.has(chunk.id)) {
      this.renderPendingTool(chunk.id);
    }

    const existingToolCall = this.findToolCall(msg, chunk.id);
    if (existingToolCall) {
      this.applyRegularToolResult(chunk, existingToolCall, normalizedContent);
    }

    this.showThinkingIndicator();
  }

  // Applies a regular (non-subagent) tool_result: status (error → blocked →
  // completed, with the skipsBlockedDetection exemption), result text,
  // AskUserQuestion answers, the rendered block, then the vault refresh.
  private applyRegularToolResult(
    chunk: { id: string; isError?: boolean; toolUseResult?: SDKToolUseResult },
    existingToolCall: ToolCallInfo,
    normalizedContent: string,
  ): void {
    const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);

    // Tools that resolve via dedicated callbacks (not content-based) skip
    // blocked detection — their status is determined solely by isError
    if (chunk.isError) {
      existingToolCall.status = 'error';
    } else if (!skipsBlockedDetection(existingToolCall.name) && isBlocked) {
      existingToolCall.status = 'blocked';
    } else {
      existingToolCall.status = 'completed';
    }
    existingToolCall.result = normalizedContent;

    if (existingToolCall.name === TOOL_ASK_USER_QUESTION) {
      const answers =
        extractResolvedAnswers(chunk.toolUseResult) ??
        extractResolvedAnswersFromResultText(normalizedContent);
      if (answers) existingToolCall.resolvedAnswers = answers;
    }

    this.renderToolResultBlock(chunk, existingToolCall, isBlocked);

    if (!chunk.isError && !isBlocked) {
      notifyVaultForToolResult(this.deps.plugin.app, existingToolCall);
      this.recordEditedFiles(existingToolCall);
    }
  }

  /**
   * Adds the file(s) a successful Write/Edit/NotebookEdit/apply_patch touched to
   * the per-tab "files changed by the agent" list. Only in-vault paths are listed.
   * Resolution does NOT require the file to be indexed yet: a just-created file's
   * vault discovery (scheduled by {@link notifyVaultForToolResult}) is still in
   * flight here, so an existence check would drop brand-new files. The chip's
   * click handler re-resolves with an existence check and surfaces a Notice if the
   * file is truly gone. Opt-out via the `showAgentEditedFiles` setting. Runs after
   * {@link renderToolResultBlock} so the Write/Edit diff is already on the tool
   * call for the created-vs-edited heuristic.
   */
  private recordEditedFiles(toolCall: ToolCallInfo): void {
    if (this.deps.plugin.settings.showAgentEditedFiles === false) return;

    const { app } = this.deps.plugin;

    for (const raw of collectEditedPathsFromToolCall(toolCall)) {
      const openable = toVaultRelativeOpenPath(app, raw.path);
      if (openable) this.deps.state.recordEditedFile({ path: openable, changeKind: raw.changeKind });
    }

    // A delete or rename vacates a file the list may already show; drop that chip.
    for (const removed of collectRemovedPathsFromToolCall(toolCall)) {
      const openable = toVaultRelativeOpenPath(app, removed);
      if (openable) this.deps.state.removeEditedFile(openable);
    }
  }

  /** Finalizes the write/edit diff block or refreshes the generic tool block for a result. */
  private renderToolResultBlock(
    chunk: { id: string; isError?: boolean; toolUseResult?: SDKToolUseResult },
    existingToolCall: ToolCallInfo,
    isBlocked: boolean,
  ): void {
    const { state } = this.deps;
    const writeEditState = state.writeEditStates.get(chunk.id);
    if (writeEditState && isWriteEditTool(existingToolCall.name)) {
      if (!chunk.isError && !isBlocked) {
        const diffData = extractDiffData(chunk.toolUseResult, existingToolCall);
        if (diffData) {
          existingToolCall.diffData = diffData;
          updateWriteEditWithDiff(writeEditState, diffData);
        }
      }
      finalizeWriteEditBlock(writeEditState, chunk.isError || isBlocked);
      return;
    }

    this.cancelPendingToolOutputRender(chunk.id);
    updateToolCallResult(
      this.deps.plugin.app,
      chunk.id,
      existingToolCall,
      state.toolCallElements,
    );
  }

  // ============================================
  // Text Block Management
  // ============================================

  async appendText(text: string): Promise<void> {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    // Snapshot the collapse setting once, when the block starts. Reading it again
    // mid-block would let a toggle race the append/render/finalize steps; instead
    // a block keeps the mode it started in and a toggle applies to the next block.
    if (!state.currentTextEl) {
      state.currentTextEl = state.currentContentEl.createDiv({ cls: 'claudian-text-block' });
      state.currentTextContent = '';
      this.currentTextBlockCollapsed = this.shouldCollapseStreamingResponse();
    }

    if (!this.currentTextBlockCollapsed) {
      this.hideThinkingIndicator();
    }

    state.currentTextContent += text;

    if (this.currentTextBlockCollapsed) {
      // Hide the half-formed render: keep an immediate placeholder up and render
      // the whole block in one pass when it finalizes.
      this.indicator.showWriting();
      return;
    }

    void this.scheduleCurrentTextRender();
  }

  async finalizeCurrentTextBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    await this.flushPendingTextRender();

    // A block keeps the collapse mode it started in (snapshotted in appendText),
    // so finalize follows that snapshot, not the live setting.
    const collapsed = this.currentTextBlockCollapsed;
    // A collapsed block kept its "Writing response..." placeholder up for the
    // whole block; drop it before the one-pass render below.
    if (collapsed) {
      this.hideThinkingIndicator();
    }

    if (msg && state.currentTextContent) {
      await this.renderFinalizedTextBlock(state.currentTextEl, state.currentTextContent, collapsed);
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: 'text', content: state.currentTextContent });
      // Work-order tabs swap a completed handoff block for the compact card on
      // finalize; everything else keeps the raw text block plus copy button.
      // Derive the content element from the text element's parent because
      // `InputController` nulls `state.currentContentEl` right before this
      // call — guarding on `state.currentContentEl` here would mean the live
      // swap never fires on a normal completed turn (only after a reload).
      const liveContentEl =
        (state.currentTextEl?.parentElement as HTMLElement | null | undefined)
          ?? state.currentContentEl;
      const replacedWithCard =
        liveContentEl && state.currentTextEl
          ? renderer.finalizeStreamedAssistantText?.(
              liveContentEl,
              state.currentTextEl,
              state.currentTextContent,
            ) ?? false
          : false;
      // Copy button added here (not during streaming) to match history-loaded messages
      if (state.currentTextEl && !replacedWithCard) {
        renderer.addTextCopyButton(state.currentTextEl, state.currentTextContent);
      }
      // The card swap removed the text block that registered actions anchor to;
      // re-anchor them onto the card so a freshly completed run keeps actions
      // (e.g. Create work order) without waiting for a reload.
      if (replacedWithCard && msg) {
        renderer.refreshMessageActions?.(msg);
      }
    }
    state.currentTextEl = null;
    state.currentTextContent = '';
    this.currentTextBlockCollapsed = false;
  }

  /**
   * Renders the finalized text into its element. A collapsed block was never
   * live-rendered, so render it once now; a non-collapsed block already holds the
   * streamed render and only needs a re-render to bake deferred math.
   */
  private async renderFinalizedTextBlock(
    textEl: HTMLElement | null,
    content: string,
    collapsed: boolean,
  ): Promise<void> {
    if (!textEl) return;
    if (collapsed) {
      await this.deps.renderer.renderContent(textEl, content);
      return;
    }
    if (this.shouldDeferMathRendering() && hasStreamingMathDelimiters(content)) {
      await this.deps.renderer.renderContent(textEl, content);
    }
  }

  private scheduleCurrentTextRender(): Promise<void> {
    if (!this.pendingTextRenderPromise) {
      this.pendingTextRenderPromise = new Promise(resolve => {
        this.resolvePendingTextRender = resolve;
      });
    }

    if (this.pendingTextRenderFrame === null && !this.isTextRenderRunning) {
      this.pendingTextRenderFrame = this.scheduleStreamContinuation(
        this.deps.state.currentTextContent,
        this.getStreamingRenderWindow(),
        () => {
          this.pendingTextRenderFrame = null;
          void this.renderPendingText();
        },
      );
    }

    return this.pendingTextRenderPromise;
  }

  private async flushPendingTextRender(): Promise<void> {
    const pendingRender = this.pendingTextRenderPromise;
    if (!pendingRender) return;

    if (this.pendingTextRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingTextRenderFrame);
      this.pendingTextRenderFrame = null;
      void this.renderPendingText();
    }

    await pendingRender;
  }

  // Full re-parse of the accumulated block on every throttled tick (O(C)/tick, see
  // PERF-3 note on the backoff constants above) — not an O(1) delta append.
  private async renderPendingText(): Promise<void> {
    if (this.isTextRenderRunning) return;
    this.isTextRenderRunning = true;

    const { state, renderer } = this.deps;
    const textEl = state.currentTextEl;
    const content = state.currentTextContent;

    try {
      if (textEl) {
        const options = this.getStreamingRenderOptions(content);
        if (options) {
          await renderer.renderContent(textEl, content, options);
        } else {
          await renderer.renderContent(textEl, content);
        }
        this.scrollToBottom();
      }
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
    } finally {
      this.isTextRenderRunning = false;
    }

    if (state.currentTextEl === textEl && state.currentTextContent !== content) {
      this.pendingTextRenderFrame = this.scheduleStreamContinuation(
        state.currentTextContent,
        this.getStreamingRenderWindow(),
        () => {
          this.pendingTextRenderFrame = null;
          void this.renderPendingText();
        },
      );
      return;
    }

    const resolve = this.resolvePendingTextRender;
    this.pendingTextRenderPromise = null;
    this.resolvePendingTextRender = null;
    resolve?.();
  }

  /**
   * Schedules the next streaming render of a growing block. Each render is a full
   * re-parse of the accumulated content — O(C) per throttled tick, not O(1)/chunk.
   * Small blocks re-render every animation frame; large blocks coalesce behind a delay
   * (PERF-3 backoff) so the O(C²) cumulative re-parse cost stays bounded. Either way
   * the trailing render is exact via the synchronous flush path.
   */
  private scheduleStreamContinuation(
    content: string,
    renderWindow: Window | null,
    callback: () => void,
  ): ScheduledAnimationFrame {
    if (content.length >= StreamController.STREAM_REPARSE_BACKOFF_THRESHOLD_CHARS) {
      return scheduleDelayedFrame(callback, StreamController.STREAM_REPARSE_BACKOFF_MS, renderWindow);
    }
    return scheduleAnimationFrame(callback, renderWindow);
  }

  private cancelPendingTextRender(): void {
    if (this.pendingTextRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingTextRenderFrame);
      this.pendingTextRenderFrame = null;
    }

    const resolve = this.resolvePendingTextRender;
    this.pendingTextRenderPromise = null;
    this.resolvePendingTextRender = null;
    resolve?.();
  }

  private scheduleToolOutputRender(toolId: string, toolCall: ToolCallInfo): void {
    if (this.pendingToolOutputFrames.has(toolId)) return;

    // Large tool output (e.g. long Bash logs) re-renders the whole growing result every
    // frame. The structured tool renderers (line clamping, expand/collapse) make a safe
    // delta-append impractical, so we apply the same size-aware backoff used for text to
    // cap the re-render rate; the final result is rendered exactly on tool_result.
    const render = () => {
      this.pendingToolOutputFrames.delete(toolId);
      updateToolCallResult(
        this.deps.plugin.app,
        toolId,
        toolCall,
        this.deps.state.toolCallElements,
      );
      this.scrollToBottom();
    };
    const frame = this.scheduleStreamContinuation(
      toolCall.result ?? '',
      this.getMessagesWindow(),
      render,
    );
    this.pendingToolOutputFrames.set(toolId, frame);
  }

  private cancelPendingToolOutputRender(toolId: string): void {
    const frame = this.pendingToolOutputFrames.get(toolId);
    if (!frame) return;

    cancelScheduledAnimationFrame(frame);
    this.pendingToolOutputFrames.delete(toolId);
  }

  private cancelPendingToolOutputRenders(): void {
    for (const frame of this.pendingToolOutputFrames.values()) {
      cancelScheduledAnimationFrame(frame);
    }
    this.pendingToolOutputFrames.clear();
  }

  // ============================================
  // Thinking Block Management
  // ============================================

  async appendThinking(content: string): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();
    if (!state.currentThinkingState) {
      state.currentThinkingState = createThinkingBlock(
        state.currentContentEl,
        (el, md) => renderer.renderContent(el, md)
      );
    }

    state.currentThinkingState.content += content;
    void this.scheduleCurrentThinkingRender();
  }

  async finalizeCurrentThinkingBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentThinkingState) return;
    await this.flushPendingThinkingRender();

    const thinkingState = state.currentThinkingState;
    if (this.getStreamingRenderOptions(thinkingState.content)) {
      await renderer.renderContent(thinkingState.contentEl, thinkingState.content);
    }

    const durationSeconds = finalizeThinkingBlock(thinkingState);

    if (msg && thinkingState.content) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: 'thinking',
        content: thinkingState.content,
        durationSeconds,
      });
    }

    state.currentThinkingState = null;
  }

  private scheduleCurrentThinkingRender(): Promise<void> {
    if (!this.pendingThinkingRenderPromise) {
      this.pendingThinkingRenderPromise = new Promise(resolve => {
        this.resolvePendingThinkingRender = resolve;
      });
    }

    if (this.pendingThinkingRenderFrame === null && !this.isThinkingRenderRunning) {
      this.pendingThinkingRenderFrame = this.scheduleStreamContinuation(
        this.deps.state.currentThinkingState?.content ?? '',
        this.getThinkingRenderWindow(),
        () => {
          this.pendingThinkingRenderFrame = null;
          void this.renderPendingThinking();
        },
      );
    }

    return this.pendingThinkingRenderPromise;
  }

  private async flushPendingThinkingRender(): Promise<void> {
    const pendingRender = this.pendingThinkingRenderPromise;
    if (!pendingRender) return;

    if (this.pendingThinkingRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingThinkingRenderFrame);
      this.pendingThinkingRenderFrame = null;
      void this.renderPendingThinking();
    }

    await pendingRender;
  }

  private async renderPendingThinking(): Promise<void> {
    if (this.isThinkingRenderRunning) return;
    this.isThinkingRenderRunning = true;

    const { state, renderer } = this.deps;
    const thinkingState = state.currentThinkingState;
    const content = thinkingState?.content ?? '';

    try {
      if (thinkingState) {
        const options = this.getStreamingRenderOptions(content);
        if (options) {
          await renderer.renderContent(thinkingState.contentEl, content, options);
        } else {
          await renderer.renderContent(thinkingState.contentEl, content);
        }
        this.scrollToBottom();
      }
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
    } finally {
      this.isThinkingRenderRunning = false;
    }

    if (state.currentThinkingState === thinkingState && thinkingState && thinkingState.content !== content) {
      this.pendingThinkingRenderFrame = this.scheduleStreamContinuation(
        thinkingState.content,
        this.getThinkingRenderWindow(),
        () => {
          this.pendingThinkingRenderFrame = null;
          void this.renderPendingThinking();
        },
      );
      return;
    }

    const resolve = this.resolvePendingThinkingRender;
    this.pendingThinkingRenderPromise = null;
    this.resolvePendingThinkingRender = null;
    resolve?.();
  }

  private cancelPendingThinkingRender(): void {
    if (this.pendingThinkingRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingThinkingRenderFrame);
      this.pendingThinkingRenderFrame = null;
    }

    const resolve = this.resolvePendingThinkingRender;
    this.pendingThinkingRenderPromise = null;
    this.resolvePendingThinkingRender = null;
    resolve?.();
  }

  /** Forwarded from SubagentManager (via tab wiring) when an async subagent's state changes. */
  onAsyncSubagentStateChange(subagent: SubagentInfo): void {
    this.subagents.onAsyncSubagentStateChange(subagent);
  }

  // ============================================
  // Thinking Indicator
  // ============================================

  /**
   * Shows the debounced "thinking" status indicator beneath the active turn.
   * Public because InputController and tabRuntimeHost drive it too; delegates to
   * the shared {@link StreamingIndicator}.
   */
  showThinkingIndicator(overrideText?: string, overrideCls?: string): void {
    this.indicator.show(overrideText, overrideCls);
  }

  /** Hides the thinking indicator and cancels any pending show timeout. */
  hideThinkingIndicator(): void {
    this.indicator.hide();
  }

  // ============================================
  // Compact Boundary
  // ============================================

  // ============================================
  // Runtime Error Card (UX-F/UX-J)
  // ============================================

  /**
   * Classifies a runtime `error` chunk and renders an actionable recovery card.
   * Open-settings and retry callbacks are wired only when the underlying surface
   * is available, so the card never offers an action it can't perform.
   */
  private renderRuntimeError(content: string): void {
    const { state, plugin } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();

    const kind = classifyRuntimeError(content);
    const providerId = this.getActiveProviderId();

    const onOpenSettings =
      kind === 'cli-not-found' || kind === 'unauthenticated'
        ? () => {
            openClaudianProviderSettings(plugin.app, plugin.manifest.id, providerId);
          }
        : undefined;

    // Retry re-dispatches the *user's* last turn, so it must not appear on errors
    // from an auto-triggered background turn — there is no user prompt behind it,
    // and retrying would resend an unrelated chat turn (duplicating work).
    const onRetry =
      !this.renderingAutoTurn && this.deps.onRetryLastTurn
        ? () => this.deps.onRetryLastTurn?.()
        : undefined;

    renderInlineRuntimeError(state.currentContentEl, {
      kind,
      content,
      providerId,
      onOpenSettings,
      onRetry,
    });
  }

  private renderCompactBoundary(): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();
    const el = state.currentContentEl.createDiv({ cls: 'claudian-compact-boundary' });
    el.createSpan({ cls: 'claudian-compact-boundary-label', text: 'Conversation compacted' });
  }

  // ============================================
  // Utilities
  // ============================================

  /** Scrolls messages to bottom if auto-scroll is enabled. */
  private scrollToBottom(): void {
    if (this.pendingScrollFrame !== null) return;

    this.pendingScrollFrame = scheduleAnimationFrame(() => {
      this.pendingScrollFrame = null;
      this.applyScrollToBottom();
    }, this.getMessagesWindow());
  }

  private applyScrollToBottom(): void {
    const { state, plugin } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    // `autoScrollEnabled` is the pinned-to-bottom flag: the scroll handler flips it off
    // when the user scrolls up and back on when they return to the bottom. Gating on it here
    // (instead of measuring scrollHeight every chunk) keeps streaming off the layout hot path.
    if (!state.autoScrollEnabled) return;

    scrollMessagesToBottom(this.deps.getMessagesEl());
  }

  private cancelPendingScroll(): void {
    if (this.pendingScrollFrame === null) return;

    cancelScheduledAnimationFrame(this.pendingScrollFrame);
    this.pendingScrollFrame = null;
  }

  private getMessagesWindow(): Window | null {
    return this.deps.getMessagesEl().ownerDocument.defaultView ?? null;
  }

  private getStreamingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentTextEl?.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  private getThinkingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentThinkingState?.contentEl.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  resetStreamingState(): void {
    const { state } = this.deps;
    this.cancelPendingTextRender();
    this.cancelPendingThinkingRender();
    this.cancelPendingToolOutputRenders();
    this.cancelPendingScroll();
    this.hideThinkingIndicator();
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    this.currentTextBlockCollapsed = false;
    state.currentThinkingState = null;
    this.deps.subagentManager.resetStreamingState();
    state.pendingTools.clear();
    // Reset response timer (duration already captured at this point)
    state.responseStartTime = null;
    void this.deps.plugin.gitStatusWatcher?.refresh();
  }
}
