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
  isSubagentToolName,
  isWriteEditTool,
  skipsBlockedDetection,
  TOOL_AGENT_OUTPUT,
  TOOL_ASK_USER_QUESTION,
  TOOL_TASK,
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
import { formatDurationMmSs } from '../../../utils/date';
import { extractDiffData } from '../../../utils/diff';
import { toVaultRelativeOpenPath } from '../../../utils/fileLink';
import { hasStreamingMathDelimiters } from '../../../utils/markdownMath';
import { openClaudianProviderSettings } from '../../../utils/obsidianPrivateApi';
import { FLAVOR_TEXTS } from '../constants';
import { renderInlineRuntimeError } from '../rendering/InlineRuntimeError';
import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import { scrollMessagesToBottom } from '../rendering/scrollToBottom';
import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import {
  createSubagentBlock,
  finalizeSubagentBlock,
  type SubagentState,
} from '../rendering/SubagentRenderer';
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
import { classifyRuntimeError } from './runtimeErrorClassification';
import {
  type BlockTransitionDecision,
  projectBlockTransition,
  projectCompactBoundary,
  type ProjectionBlockState,
  projectNoticeText,
  projectUsage,
} from './StreamProjection';
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
  private static readonly ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS = [200, 600, 1500] as const;

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
  private pendingThinkingRenderFrame: ScheduledAnimationFrame | null = null;
  private pendingThinkingRenderPromise: Promise<void> | null = null;
  private resolvePendingThinkingRender: (() => void) | null = null;
  private isThinkingRenderRunning = false;
  private pendingToolOutputFrames = new Map<string, ScheduledAnimationFrame>();
  private pendingScrollFrame: ScheduledAnimationFrame | null = null;

  // Provider lifecycle agent tracking (spawn → wait/close lifecycle)
  private lifecycleSubagentStates = new Map<string, SubagentState>(); // spawn callId → SubagentState
  private lifecycleAgentIdToSpawnId = new Map<string, string>();      // agentId → spawn callId

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

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
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
        await this.handleSubagentChunk(chunk, msg);
        return true;

      case 'async_subagent_result':
        await this.handleAsyncSubagentResult(chunk);
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
    if (isSubagentToolName(chunk.name)) {
      // Flush pending tools before Agent
      this.flushPendingTools();
      this.handleTaskToolUseViaManager(chunk, msg);
      return;
    }

    if (chunk.name === TOOL_AGENT_OUTPUT) {
      this.handleAgentOutputToolUse(chunk, msg);
      return;
    }

    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(chunk.name);
    if (subagentLifecycleAdapter?.isSpawnTool(chunk.name)) {
      this.handleProviderSubagentSpawn(chunk, msg, subagentLifecycleAdapter);
      return;
    }
    if (subagentLifecycleAdapter?.isHiddenTool(chunk.name)) {
      this.handleProviderHiddenSubagentTool(chunk, msg);
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

  // ============================================
  // Provider lifecycle subagents (spawn → wait/close)
  // ============================================

  private handleProviderSubagentSpawn(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
  ): void {
    const { state } = this.deps;

    const toolCall = createRunningToolCall(chunk);
    appendToolCallToMessage(msg, toolCall);

    // Render as subagent block immediately
    if (state.currentContentEl) {
      this.flushPendingTools();
      const subagentInfo = adapter.buildSubagentInfo(toolCall, msg.toolCalls);

      const subagentState = createSubagentBlock(this.deps.plugin.app, state.currentContentEl, chunk.id, {
        description: subagentInfo.description,
        prompt: subagentInfo.prompt,
      });
      this.lifecycleSubagentStates.set(chunk.id, subagentState);
    }
  }

  private handleProviderHiddenSubagentTool(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    // Track in toolCalls for data completeness, but don't create DOM or content block
    const toolCall = createRunningToolCall(chunk);
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
  }

  /**
   * Handles tool_result for provider lifecycle subagent tools.
   * Returns true if the result was consumed (caller should return early).
   */
  private handleProviderSubagentResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean },
    msg: ChatMessage
  ): boolean {
    const existingToolCall = this.findToolCall(msg, chunk.id);
    if (!existingToolCall) return false;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    const adapter = this.getSubagentLifecycleAdapter(existingToolCall.name);
    if (!adapter) return false;

    if (adapter.isSpawnTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      this.applyProviderSubagentSpawnResult(chunk, msg, adapter, existingToolCall, normalizedContent);
      return true;
    }

    if (adapter.isWaitTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      this.applyProviderSubagentWaitResult(msg, adapter, existingToolCall);
      return true;
    }

    if (adapter.isCloseTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      return true;
    }

    return false;
  }

  /** Maps a completed spawn tool's result onto its lifecycle subagent block. */
  private applyProviderSubagentSpawnResult(
    chunk: { id: string; isError?: boolean },
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
    existingToolCall: ToolCallInfo,
    normalizedContent: string,
  ): void {
    const spawnResult = adapter.extractSpawnResult(normalizedContent);
    if (spawnResult.agentId) {
      this.lifecycleAgentIdToSpawnId.set(spawnResult.agentId, chunk.id);
    }

    const subagentState = this.lifecycleSubagentStates.get(chunk.id);
    if (!subagentState) return;

    const subagentInfo = adapter.buildSubagentInfo(existingToolCall, msg.toolCalls ?? []);
    subagentState.info.description = subagentInfo.description;
    subagentState.info.prompt = subagentInfo.prompt;
    subagentState.labelEl.setText(
      subagentInfo.description.length > 40
        ? subagentInfo.description.substring(0, 40) + '...'
        : subagentInfo.description
    );

    if (chunk.isError) {
      finalizeSubagentBlock(subagentState, normalizedContent || 'Error', true);
    }
  }

  /** Finalizes each spawned subagent block resolved by a completed wait tool. */
  private applyProviderSubagentWaitResult(
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
    existingToolCall: ToolCallInfo,
  ): void {
    for (const spawnId of adapter.resolveSpawnToolIds(
      existingToolCall,
      this.lifecycleAgentIdToSpawnId,
    )) {
      const spawnToolCall = this.findToolCall(msg, spawnId);
      const subagentState = this.lifecycleSubagentStates.get(spawnId);
      if (!spawnToolCall || !subagentState) continue;

      const subagentInfo = adapter.buildSubagentInfo(spawnToolCall, msg.toolCalls ?? []);
      subagentState.info.description = subagentInfo.description;
      subagentState.info.prompt = subagentInfo.prompt;

      if (subagentInfo.status === 'completed' || subagentInfo.status === 'error') {
        finalizeSubagentBlock(
          subagentState,
          subagentInfo.result || (subagentInfo.status === 'error' ? 'Error' : 'DONE'),
          subagentInfo.status === 'error'
        );
      }
    }
  }

  private async handleToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult },
    msg: ChatMessage
  ): Promise<void> {
    const { state, subagentManager } = this.deps;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    // Resolve pending Task before processing result.
    if (subagentManager.hasPendingTask(chunk.id)) {
      this.renderPendingTaskFromTaskResultViaManager(chunk, msg);
      subagentManager.hydrateNestedSyncToolsFromTaskResult(chunk.id, chunk.toolUseResult);
    }

    // Check if it's a sync subagent result
    const subagentState = subagentManager.getSyncSubagent(chunk.id);
    if (subagentState) {
      this.finalizeSubagent(chunk, msg);
      return;
    }

    // Check if it's an async task result
    if (this.handleAsyncTaskToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    // Check if it's an agent output result
    if (await this.handleAgentOutputToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    if (this.handleProviderSubagentResult(chunk, msg)) {
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

    this.hideThinkingIndicator();

    if (!state.currentTextEl) {
      state.currentTextEl = state.currentContentEl.createDiv({ cls: 'claudian-text-block' });
      state.currentTextContent = '';
    }

    state.currentTextContent += text;
    void this.scheduleCurrentTextRender();
  }

  async finalizeCurrentTextBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    await this.flushPendingTextRender();

    if (msg && state.currentTextContent) {
      if (
        state.currentTextEl
        && this.shouldDeferMathRendering()
        && hasStreamingMathDelimiters(state.currentTextContent)
      ) {
        await renderer.renderContent(state.currentTextEl, state.currentTextContent);
      }
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

  // ============================================
  // Subagent Tool Handling (via SubagentManager)
  // ============================================

  /** Delegates Agent tool_use to SubagentManager and updates message based on result. */
  private handleTaskToolUseViaManager(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state, subagentManager } = this.deps;
    this.ensureTaskToolCall(msg, chunk.id, chunk.input);

    const result = subagentManager.handleTaskToolUse(chunk.id, chunk.input, state.currentContentEl);

    switch (result.action) {
      case 'created_sync':
        this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
        this.showThinkingIndicator();
        break;
      case 'created_async':
        this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
        this.showThinkingIndicator();
        break;
      case 'buffered':
        this.showThinkingIndicator();
        break;
      case 'label_updated':
        break;
    }
  }

  /** Renders a pending Agent tool call via SubagentManager and updates message. */
  private renderPendingTaskViaManager(toolId: string, msg: ChatMessage): void {
    const result = this.deps.subagentManager.renderPendingTask(toolId, this.deps.state.currentContentEl);
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, toolId);
    } else {
      this.recordSubagentInMessage(msg, result.info, toolId, 'async');
    }
  }

  /** Resolves a pending Agent tool call when its own tool_result arrives. */
  private renderPendingTaskFromTaskResultViaManager(
    chunk: { id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage
  ): void {
    const result = this.deps.subagentManager.renderPendingTaskFromTaskResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      this.deps.state.currentContentEl,
      chunk.toolUseResult
    );
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
    } else {
      this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
    }
  }

  private recordSubagentInMessage(
    msg: ChatMessage,
    info: SubagentInfo,
    toolId: string,
    mode?: 'async'
  ): void {
    const taskToolCall = this.ensureTaskToolCall(msg, toolId);
    this.applySubagentToTaskToolCall(taskToolCall, info);

    msg.contentBlocks = msg.contentBlocks || [];
    const existingBlock = msg.contentBlocks.find(
      block => block.type === 'subagent' && block.subagentId === toolId
    );
    if (existingBlock && mode && existingBlock.type === 'subagent') {
      existingBlock.mode = mode;
    } else if (!existingBlock) {
      msg.contentBlocks.push(mode
        ? { type: 'subagent', subagentId: toolId, mode }
        : { type: 'subagent', subagentId: toolId }
      );
    }
  }

  private async handleSubagentChunk(
    chunk: Extract<StreamChunk, { type: 'subagent_tool_use' | 'subagent_tool_result' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const parentToolUseId = chunk.subagentId;
    const { subagentManager } = this.deps;

    // If parent Agent call is still pending, child chunk confirms it's sync - render now
    if (subagentManager.hasPendingTask(parentToolUseId)) {
      this.renderPendingTaskViaManager(parentToolUseId, msg);
    }

    const subagentState = subagentManager.getSyncSubagent(parentToolUseId);

    if (!subagentState) {
      return;
    }

    switch (chunk.type) {
      case 'subagent_tool_use': {
        const toolCall = createRunningToolCall(chunk);
        subagentManager.addSyncToolCall(parentToolUseId, toolCall);
        this.showThinkingIndicator();
        break;
      }

      case 'subagent_tool_result': {
        const toolCall = subagentState.info.toolCalls.find((tc: ToolCallInfo) => tc.id === chunk.id);
        if (toolCall) {
          const normalizedContent = this.normalizeToolResultContent(chunk.content);
          const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);
          toolCall.status = isBlocked ? 'blocked' : (chunk.isError ? 'error' : 'completed');
          toolCall.result = normalizedContent;
          subagentManager.updateSyncToolResult(parentToolUseId, chunk.id, toolCall);
          // Surface files a sub-agent edits in the same strip as top-level edits.
          if (toolCall.status === 'completed') this.recordEditedFiles(toolCall);
        }
        break;
      }

      default:
        break;
    }
  }

  /** Finalizes a sync subagent when its Agent tool_result is received. */
  private finalizeSubagent(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage
  ): void {
    const isError = chunk.isError || false;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);
    const finalized = this.deps.subagentManager.finalizeSyncSubagent(
      chunk.id, chunk.content, isError, chunk.toolUseResult
    );

    const extractedResult = finalized?.result ?? normalizedContent;

    const taskToolCall = this.ensureTaskToolCall(msg, chunk.id);
    taskToolCall.status = isError ? 'error' : 'completed';
    taskToolCall.result = extractedResult;
    if (taskToolCall.subagent) {
      taskToolCall.subagent.status = isError ? 'error' : 'completed';
      taskToolCall.subagent.result = extractedResult;
    }

    if (finalized) {
      this.applySubagentToTaskToolCall(taskToolCall, finalized);
    }

    this.showThinkingIndicator();
  }

  // ============================================
  // Async Subagent Handling
  // ============================================

  /** Handles TaskOutput tool_use (invisible, links to async subagent). */
  private handleAgentOutputToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    _msg: ChatMessage
  ): void {
    const toolCall = createRunningToolCall(chunk);

    this.deps.subagentManager.handleAgentOutputToolUse(toolCall);

    // Show flavor text while waiting for TaskOutput result
    this.showThinkingIndicator();
  }

  private handleAsyncTaskToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown }
  ): boolean {
    const { subagentManager } = this.deps;
    if (!subagentManager.isPendingAsyncTask(chunk.id)) {
      return false;
    }

    subagentManager.handleTaskToolResult(chunk.id, chunk.content, chunk.isError, chunk.toolUseResult);
    return true;
  }

  /** Handles TaskOutput result to finalize async subagent. */
  private async handleAgentOutputToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown }
  ): Promise<boolean> {
    const { subagentManager } = this.deps;
    const isLinked = subagentManager.isLinkedAgentOutputTool(chunk.id);

    const handled = subagentManager.handleAgentOutputToolResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      chunk.toolUseResult
    );

    await this.hydrateAsyncSubagentToolCalls(handled);

    return isLinked || handled !== undefined;
  }

  private async handleAsyncSubagentResult(
    chunk: Extract<StreamChunk, { type: 'async_subagent_result' }>
  ): Promise<void> {
    const handled = this.deps.subagentManager.handleAsyncSubagentResult(
      chunk.agentId,
      chunk.status,
      chunk.result
    );

    await this.hydrateAsyncSubagentToolCalls(handled);
    if (handled) {
      this.showThinkingIndicator();
    }
  }

  private async hydrateAsyncSubagentToolCalls(subagent: SubagentInfo | undefined): Promise<void> {
    if (!subagent) return;
    if (subagent.mode !== 'async') return;
    if (!subagent.agentId) return;

    const asyncStatus = subagent.asyncStatus ?? subagent.status;
    if (asyncStatus !== 'completed' && asyncStatus !== 'error') return;

    const runtime = this.deps.getAgentService?.();
    if (!runtime) return;

    const { hasHydrated, finalResultHydrated } = await this.tryHydrateAsyncSubagent(
      subagent,
      runtime,
      true
    );

    if (hasHydrated) {
      this.deps.subagentManager.refreshAsyncSubagent(subagent);
    }

    if (!finalResultHydrated) {
      this.scheduleAsyncSubagentResultRetry(subagent, runtime, 0);
    }
  }

  private async tryHydrateAsyncSubagent(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    hydrateToolCalls: boolean
  ): Promise<{ hasHydrated: boolean; finalResultHydrated: boolean }> {
    let hasHydrated = false;
    let finalResultHydrated = false;

    if (hydrateToolCalls && !subagent.toolCalls?.length) {
      const recoveredToolCalls = await runtime.loadSubagentToolCalls?.(
        subagent.agentId || ''
      ) ?? [];
      if (recoveredToolCalls.length > 0) {
        subagent.toolCalls = recoveredToolCalls.map((toolCall) => ({
          ...toolCall,
          input: { ...toolCall.input },
        }));
        hasHydrated = true;
      }
    }

    const recoveredFinalResult = await runtime.loadSubagentFinalResult?.(
      subagent.agentId || ''
    ) ?? null;
    if (recoveredFinalResult && recoveredFinalResult.trim().length > 0) {
      finalResultHydrated = true;
      if (recoveredFinalResult !== subagent.result) {
        subagent.result = recoveredFinalResult;
        hasHydrated = true;
      }
    }

    return { hasHydrated, finalResultHydrated };
  }

  private scheduleAsyncSubagentResultRetry(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    attempt: number
  ): void {
    if (!subagent.agentId) return;
    if (attempt >= StreamController.ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS.length) return;

    const delay = StreamController.ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS[attempt];
    window.setTimeout(() => {
      void this.retryAsyncSubagentResult(subagent, runtime, attempt);
    }, delay);
  }

  private async retryAsyncSubagentResult(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    attempt: number
  ): Promise<void> {
    if (!subagent.agentId) return;
    const asyncStatus = subagent.asyncStatus ?? subagent.status;
    if (asyncStatus !== 'completed' && asyncStatus !== 'error') return;

    const { hasHydrated, finalResultHydrated } = await this.tryHydrateAsyncSubagent(
      subagent,
      runtime,
      false
    );
    if (hasHydrated) {
      this.deps.subagentManager.refreshAsyncSubagent(subagent);
    }

    if (!finalResultHydrated) {
      this.scheduleAsyncSubagentResultRetry(subagent, runtime, attempt + 1);
    }
  }

  /** Callback from SubagentManager when async state changes. Updates messages only (DOM handled by manager). */
  onAsyncSubagentStateChange(subagent: SubagentInfo): void {
    this.updateSubagentInMessages(subagent);
    this.scrollToBottom();
  }

  private updateSubagentInMessages(subagent: SubagentInfo): void {
    const { state } = this.deps;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg.role !== 'assistant') continue;
      if (this.linkTaskToolCallToSubagent(msg, subagent)) {
        return;
      }
    }
  }

  private ensureTaskToolCall(
    msg: ChatMessage,
    toolId: string,
    input?: Record<string, unknown>
  ): ToolCallInfo {
    msg.toolCalls = msg.toolCalls || [];
    const existingById = this.findToolCall(msg, toolId);
    const existing = existingById && isSubagentToolName(existingById.name)
      ? existingById
      : undefined;
    if (existing) {
      if (input && Object.keys(input).length > 0) {
        existing.input = { ...existing.input, ...input };
      }
      return existing;
    }

    const taskToolCall: ToolCallInfo = {
      id: toolId,
      name: TOOL_TASK,
      input: input ? { ...input } : {},
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls.push(taskToolCall);
    return taskToolCall;
  }

  private applySubagentToTaskToolCall(taskToolCall: ToolCallInfo, subagent: SubagentInfo): void {
    taskToolCall.subagent = subagent;
    if (subagent.status === 'completed') taskToolCall.status = 'completed';
    else if (subagent.status === 'error') taskToolCall.status = 'error';
    else taskToolCall.status = 'running';
    if (subagent.result !== undefined) {
      taskToolCall.result = subagent.result;
    }
  }

  private linkTaskToolCallToSubagent(msg: ChatMessage, subagent: SubagentInfo): boolean {
    const taskToolCallById = this.findToolCall(msg, subagent.id);
    const taskToolCall = taskToolCallById && isSubagentToolName(taskToolCallById.name)
      ? taskToolCallById
      : undefined;
    if (!taskToolCall) return false;
    this.applySubagentToTaskToolCall(taskToolCall, subagent);
    return true;
  }

  // ============================================
  // Thinking Indicator
  // ============================================

  /** Debounce delay before showing thinking indicator (ms). */
  private static readonly THINKING_INDICATOR_DELAY = 400;

  /**
   * Schedules showing the thinking indicator after a delay.
   * If content arrives before the delay, the indicator won't show.
   * This prevents the indicator from appearing during active streaming.
   * Note: Flavor text is hidden when model thinking block is active (thinking takes priority).
   */
  showThinkingIndicator(overrideText?: string, overrideCls?: string): void {
    const { state } = this.deps;

    // Early return if no content element
    if (!state.currentContentEl) return;

    // Clear any existing timeout
    if (state.thinkingIndicatorTimeout) {
      const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(timerWindow);
    }

    // Don't show flavor text while model thinking block is active
    if (state.currentThinkingState) {
      return;
    }

    // If indicator already exists, just re-append it to the bottom
    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator();
      return;
    }

    // Schedule showing the indicator after a delay
    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
      state.setThinkingIndicatorTimeout(null, null);
      // Double-check we still have a content element, no indicator exists, and no thinking block
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const cls = overrideCls
        ? `claudian-thinking ${overrideCls}`
        : 'claudian-thinking';
      state.thinkingEl = state.currentContentEl.createDiv({ cls });
      const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      state.thinkingEl.createSpan({ text });

      // Create timer span with initial value
      const timerSpan = state.thinkingEl.createSpan({ cls: 'claudian-thinking-hint' });
      const updateTimer = () => {
        if (!state.responseStartTime) return;
        // Check if element is still connected to DOM (prevents orphaned interval updates)
        if (!timerSpan.isConnected) {
          if (state.flavorTimerInterval) {
            state.clearFlavorTimerInterval();
          }
          return;
        }
        const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
        timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
      };
      updateTimer(); // Initial update

      // Start interval to update timer every second
      if (state.flavorTimerInterval) {
        state.clearFlavorTimerInterval();
      }
      const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? timerWindow;
      state.setFlavorTimerInterval(thinkingWindow.setInterval(updateTimer, 1000), thinkingWindow);

    }, StreamController.THINKING_INDICATOR_DELAY), timerWindow);
  }

  /** Hides the thinking indicator and cancels any pending show timeout. */
  hideThinkingIndicator(): void {
    const { state } = this.deps;

    // Cancel any pending show timeout
    if (state.thinkingIndicatorTimeout) {
      const activeWindow = this.deps.getMessagesEl().ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(activeWindow);
    }

    // Clear timer interval (but preserve responseStartTime for duration capture)
    state.clearFlavorTimerInterval();

    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
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
    state.currentThinkingState = null;
    this.deps.subagentManager.resetStreamingState();
    state.pendingTools.clear();
    // Reset response timer (duration already captured at this point)
    state.responseStartTime = null;
    void this.deps.plugin.gitStatusWatcher?.refresh();
  }
}
