/**
 * Specorator - Claude Agent SDK wrapper
 *
 * Handles communication with Claude via the Agent SDK. Manages streaming,
 * session persistence, permission modes, and security hooks.
 *
 * Architecture:
 * - Persistent query for active chat conversation (eliminates cold-start latency)
 * - Cold-start queries for inline edit, title generation
 * - MessageChannel for message queueing and turn management
 * - Dynamic updates (model, effort level, permission mode, MCP servers)
 */

import type {
  CanUseTool,
  Options,
  PermissionMode as SDKPermissionMode,
  Query,
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
  SlashCommand as SDKSlashCommand,
} from '@anthropic-ai/claude-agent-sdk';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import { Notice } from 'obsidian';

import { vetActiveServersForRuntime } from '../../../core/mcp/mcpRuntimeVetting';
import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type {
  AppAgentManager,
  AppPluginManager,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { RuntimeHost } from '../../../core/runtime/RuntimeHost';
import type {
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
  SessionUpdateResult,
} from '../../../core/runtime/types';
import { TOOL_ENTER_PLAN_MODE } from '../../../core/tools/toolNames';
import type {
  ApprovalDecision,
  ChatMessage,
  Conversation,
  ImageAttachment,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import type { PluginContext } from '../../../core/types/PluginContext';
import type { PermissionMode,SpecoratorSettings } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import { getEnhancedPath, getMissingNodeError } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { isSessionExpiredError } from '../../../utils/session';
import { CLAUDE_PROVIDER_CAPABILITIES } from '../capabilities';
import { loadSubagentFinalResult, loadSubagentToolCalls } from '../history/ClaudeHistoryStore';
import { createStopSubagentHook } from '../hooks/SubagentHooks';
import { encodeClaudeTurn } from '../prompt/ClaudeTurnEncoder';
import { isContextWindowEvent, isSessionInitEvent, isStreamChunk } from '../sdk/typeGuards';
import type { ContextWindowEvent, SessionInitEvent, TransformEvent } from '../sdk/types';
import { getClaudeProviderSettings } from '../settings';
import {
  createTransformStreamState,
  createTransformUsageState,
  transformSDKMessage,
} from '../stream/transformClaudeMessage';
import { getClaudeState } from '../types/providerState';
import { createClaudeApprovalCallback } from './ClaudeApprovalHandler';
import { applyClaudeDynamicUpdates } from './ClaudeDynamicUpdates';
import { MessageChannel } from './ClaudeMessageChannel';
import {
  type ColdStartQueryContext,
  type PersistentQueryContext,
  QueryOptionsBuilder,
  type QueryOptionsContext,
} from './ClaudeQueryOptionsBuilder';
import {
  buildHistoryContextPrompt,
  buildHistoryRebuildRequest,
  buildLegacyTurnRequest,
  buildQueryOptionsFromTurnRequest,
  computeClaudeSessionUpdates,
  createStreamingTurnHandler,
  drainStreamingTurn,
  isChatMessageArray,
  isImageAttachmentArray,
  mergeCustomModelContextLimits,
  noteVisibleStreamContent,
  resolveColdStartAllowedTools,
  resolveTurnAllowedTools,
  tryEnqueueTurnMessage,
} from './claudeQueryTurnHelpers';
import { executeClaudeRewind } from './ClaudeRewindService';
import { SessionManager } from './ClaudeSessionManager';
import {
  buildClaudePromptWithImages,
  buildClaudeSDKUserMessage,
} from './ClaudeUserMessageFactory';
import {
  createEnsureReadyDeps,
  type EnsureReadyResolvedOptions,
  type EnsureReadyRuntime,
  runEnsureReady,
} from './ensureReadyController';
import {
  type ClaudeEnsureReadyOptions,
  type ClosePersistentQueryOptions,
  isTurnCompleteMessage,
  type PersistentQueryConfig,
  type ResponseHandler,
} from './types';

export type { ApprovalDecision };
export type {
  ApprovalCallback,
  ApprovalCallbackOptions,
  AskUserQuestionCallback,
} from '../../../core/runtime/types';

export interface ClaudeRuntimeServices {
  mcpManager: McpServerManager;
  pluginManager: AppPluginManager;
  agentManager: Pick<AppAgentManager, 'setBuiltinAgentNames'>;
}

type QueryOptions = ChatRuntimeQueryOptions;

/** Bundled inputs for the persistent-path turn so helpers stay under max-params. */
interface PersistentTurnContext {
  prompt: string;
  promptToSend: string;
  images?: ImageAttachment[];
  conversationHistory?: ChatMessage[];
  vaultPath: string;
  cliPath: string;
  queryOptions?: QueryOptions;
  effectiveQueryOptions?: QueryOptions;
}

/** Mutable per-turn stream state for the cold-start path. */
interface ColdStartStreamState {
  selectedModel: string;
  sawStreamText: boolean;
  sawStreamThinking: boolean;
  streamSessionId: string | null;
  streamState: ReturnType<typeof createTransformStreamState>;
  usageState: ReturnType<typeof createTransformUsageState>;
}

export class ClaudeChatRuntime implements ChatRuntime {
  readonly providerId = CLAUDE_PROVIDER_CAPABILITIES.providerId;
  private plugin: PluginContext;
  private agentManager: Pick<AppAgentManager, 'setBuiltinAgentNames'> | null;
  private pluginManager: AppPluginManager | null;
  private abortController: AbortController | null = null;
  private readonly host: RuntimeHost;
  private vaultPath: string | null = null;
  private currentExternalContextPaths: string[] = [];
  private readyStateListeners = new Set<(ready: boolean) => void>();

  // Modular components
  private sessionManager = new SessionManager();
  private mcpManager: McpServerManager;

  private persistentQuery: Query | null = null;
  private messageChannel: MessageChannel | null = null;
  private queryAbortController: AbortController | null = null;
  private responseHandlers: ResponseHandler[] = [];
  private responseConsumerRunning = false;
  private responseConsumerPromise: Promise<void> | null = null;
  private shuttingDown = false;

  // Tracked configuration for detecting changes that require restart
  private currentConfig: PersistentQueryConfig | null = null;

  // Bound-agent overrides threaded per-turn so the restarted persistent query
  // picks them up from buildPersistentQueryOptions at startPersistentQuery time.
  private currentBoundAgentPrompt: string | undefined;
  private currentBoundAgentModel: string | undefined;
  private currentBoundAgentTools: string[] | undefined;

  // Current allowed tools for canUseTool enforcement (null = no restriction)
  private currentAllowedTools: string[] | null = null;

  private pendingResumeAt?: string;
  private pendingForkSession = false;

  // Last sent message for crash recovery (Phase 1.3)
  private lastSentMessage: SDKUserMessage | null = null;
  private lastSentQueryOptions: QueryOptions | null = null;
  private crashRecoveryAttempted = false;
  private coldStartInProgress = false;  // Prevent consumer error restarts during cold-start

  // SDK command cache — populated on system/init, cleared on persistent query close
  private cachedSdkCommands: SlashCommand[] = [];

  // Auto-triggered turn handling (e.g., task-notification delivery by the SDK)
  private _autoTurnBuffer: StreamChunk[] = [];
  private _autoTurnSawStreamText = false;
  private _autoTurnSawStreamThinking = false;
  private turnMetadata: ChatTurnMetadata = {};
  private bufferedUsageChunk: StreamChunk & { type: 'usage' } | null = null;
  private streamTransformState = createTransformStreamState();
  private usageTransformState = createTransformUsageState();

  private getLegacyPluginDeps(): PluginContext & {
    agentManager?: Pick<AppAgentManager, 'setBuiltinAgentNames'>;
    pluginManager?: AppPluginManager;
  } {
    return this.plugin;
  }

  constructor(
    plugin: PluginContext,
    services: ClaudeRuntimeServices | McpServerManager,
    host: RuntimeHost,
  ) {
    this.plugin = plugin;
    this.host = host;
    const legacyPlugin = this.getLegacyPluginDeps();

    if ('mcpManager' in services) {
      this.mcpManager = services.mcpManager;
      this.pluginManager = services.pluginManager ?? legacyPlugin.pluginManager ?? null;
      this.agentManager = services.agentManager ?? legacyPlugin.agentManager ?? null;
      return;
    }

    this.mcpManager = services;
    this.pluginManager = legacyPlugin.pluginManager ?? null;
    this.agentManager = legacyPlugin.agentManager ?? null;
  }

  getCapabilities() {
    return CLAUDE_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return encodeClaudeTurn(request, this.mcpManager);
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = { ...this.turnMetadata };
    this.turnMetadata = {};
    this.bufferedUsageChunk = null;
    return metadata;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyStateListeners.add(listener);
    try {
      listener(this.isReady());
    } catch {
      // Ignore listener errors
    }
    return () => {
      this.readyStateListeners.delete(listener);
    };
  }

  private notifyReadyStateChange(): void {
    if (this.readyStateListeners.size === 0) {
      return;
    }

    const isReady = this.isReady();
    for (const listener of this.readyStateListeners) {
      try {
        listener(isReady);
      } catch {
        // Ignore listener errors
      }
    }
  }

  private resetTurnMetadata(): void {
    this.turnMetadata = {};
    this.bufferedUsageChunk = null;
    this.usageTransformState.clear();
  }

  private recordTurnMetadata(update: Partial<ChatTurnMetadata>): void {
    this.turnMetadata = {
      ...this.turnMetadata,
      ...update,
    };
  }

  private bufferUsageChunk(chunk: Extract<StreamChunk, { type: 'usage' }>): Extract<StreamChunk, { type: 'usage' }> {
    this.bufferedUsageChunk = chunk;
    return chunk;
  }

  private updateBufferedUsageContextWindow(contextWindow: number): Extract<StreamChunk, { type: 'usage' }> | null {
    if (!this.bufferedUsageChunk || contextWindow <= 0) {
      return null;
    }

    const usage = this.bufferedUsageChunk.usage;
    const percentage = Math.min(
      100,
      Math.max(0, Math.round((usage.contextTokens / contextWindow) * 100)),
    );
    const nextChunk: Extract<StreamChunk, { type: 'usage' }> = {
      ...this.bufferedUsageChunk,
      usage: {
        ...usage,
        contextWindow,
        contextWindowIsAuthoritative: true,
        percentage,
      },
    };
    this.bufferedUsageChunk = nextChunk;
    return nextChunk;
  }

  setPendingResumeAt(uuid: string | undefined): void {
    this.pendingResumeAt = uuid;
  }

  setResumeCheckpoint(checkpointId: string | undefined): void {
    this.setPendingResumeAt(checkpointId);
  }

  /** One-shot: consumed on the next query, then cleared by routeMessage on session init. */
  private applyForkState(conv: ChatRuntimeConversationState): string | null {
    const state = getClaudeState(conv.providerState);
    const isPending = !conv.sessionId && !state.providerSessionId && !!state.forkSource;
    this.pendingForkSession = isPending;
    if (isPending) {
      this.pendingResumeAt = state.forkSource!.resumeAt;
    } else {
      this.pendingResumeAt = undefined;
    }
    return conv.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  syncConversationState(
    conversation: ChatRuntimeConversationState | null,
    externalContextPaths?: string[],
  ): void {
    if (!conversation) {
      this.pendingForkSession = false;
      this.pendingResumeAt = undefined;
      this.setSessionId(null, externalContextPaths);
      return;
    }

    const resolvedSessionId = this.applyForkState(conversation);
    this.setSessionId(resolvedSessionId, externalContextPaths);
  }

  buildSessionUpdates({ conversation, sessionInvalidated }: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return computeClaudeSessionUpdates({
      sessionId: this.getSessionId(),
      conversation,
      sessionInvalidated,
    });
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    const sessionId = this.getSessionId();
    if (sessionId) return sessionId;
    if (!conversation) return null;
    const state = getClaudeState(conversation.providerState);
    return state.providerSessionId ?? conversation.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  async loadSubagentToolCalls(agentId: string): Promise<ToolCallInfo[]> {
    const sessionId = this.getSessionId();
    const vaultPath = getVaultPath(this.plugin.app);
    if (!sessionId || !vaultPath) return [];
    return loadSubagentToolCalls(vaultPath, sessionId, agentId);
  }

  async loadSubagentFinalResult(agentId: string): Promise<string | null> {
    const sessionId = this.getSessionId();
    const vaultPath = getVaultPath(this.plugin.app);
    if (!sessionId || !vaultPath) return null;
    return loadSubagentFinalResult(vaultPath, sessionId, agentId);
  }

  async reloadMcpServers(): Promise<void> {
    await this.mcpManager.loadServers();
  }

  /**
   * Ensures the persistent query is running with current configuration.
   * Unified API that replaces preWarm() and restartPersistentQuery().
   *
   * Behavior:
   * - If not running → start (if paths available)
   * - If running and force=true → close and restart
   * - If running and config changed → close and restart
   * - If running and config unchanged → no-op
   *
   * Note: When restart is needed, the query is closed BEFORE checking if we can
   * start a new one. This ensures fallback to cold-start if CLI becomes unavailable.
   *
   * @returns true if the query was (re)started, false otherwise
   */
  async ensureReady(options?: ClaudeEnsureReadyOptions): Promise<boolean> {
    const deps = createEnsureReadyDeps(this.ensureReadyRuntime, this.resolveEnsureReadyOptions(options));
    return runEnsureReady(deps, options?.force ?? false);
  }

  /**
   * Resolves the per-call inputs `ensureReady` needs, including the external
   * context-path side effect (an explicit empty list clears tracking) and the
   * sessionManager fallback for an unspecified session id.
   */
  private resolveEnsureReadyOptions(
    options: ClaudeEnsureReadyOptions | undefined,
  ): EnsureReadyResolvedOptions {
    if (options && options.externalContextPaths !== undefined) {
      this.currentExternalContextPaths = options.externalContextPaths;
    }
    return {
      sessionId: options?.sessionId ?? this.sessionManager.getSessionId() ?? undefined,
      externalContextPaths: options?.externalContextPaths ?? this.currentExternalContextPaths,
      preserveHandlers: options?.preserveHandlers,
    };
  }

  /** Adapts this runtime's lifecycle methods to the {@link EnsureReadyRuntime} surface. */
  private get ensureReadyRuntime(): EnsureReadyRuntime {
    return {
      getVaultPath: () => getVaultPath(this.plugin.app),
      getCliPath: () => this.plugin.getResolvedProviderCliPath('claude'),
      isRunning: () => !!this.persistentQuery,
      startPersistentQuery: (vaultPath, cliPath, sessionId, externalContextPaths) =>
        this.startPersistentQuery(vaultPath, cliPath, sessionId, externalContextPaths),
      closePersistentQuery: (reason, preserveHandlers) =>
        this.closePersistentQuery(reason, { preserveHandlers }),
      needsRestartForConfig: (vaultPath, cliPath, externalContextPaths) =>
        // Include the bound-agent prompt so this unforced check matches the stored key.
        this.needsRestart(this.buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths, undefined, this.currentBoundAgentPrompt)),
    };
  }

  /**
   * Starts the persistent query for the active chat conversation.
   *
   * @param modelOverride - Optional model to use instead of `settings.model`.
   *   Pass the work-order model here so the Claude CLI process is spawned with
   *   the correct `--model` flag on the very first turn, without relying on a
   *   post-init `setModel()` call that only takes effect at turn boundaries.
   */
  private async startPersistentQuery(
    vaultPath: string,
    cliPath: string,
    resumeSessionId?: string,
    externalContextPaths?: string[],
    modelOverride?: string,
  ): Promise<void> {
    if (this.persistentQuery) {
      return;
    }

    this.shuttingDown = false;
    this.vaultPath = vaultPath;

    this.messageChannel = new MessageChannel();

    if (resumeSessionId) {
      this.messageChannel.setSessionId(resumeSessionId);
      this.sessionManager.setSessionId(resumeSessionId, this.getScopedSettings().model);
    }

    this.queryAbortController = new AbortController();

    // Fold the bound-agent prompt into the stored config so its systemPromptKey
    // matches the actual query options below; otherwise needsRestart fires every
    // bound-agent turn (stored key lacks the appendix the recomputed key has).
    const config = this.buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths, modelOverride, this.currentBoundAgentPrompt);
    this.currentConfig = config;

    const resumeAtMessageId = this.pendingResumeAt;
    const options = this.buildPersistentQueryOptions(
      vaultPath,
      cliPath,
      resumeSessionId,
      resumeAtMessageId,
      externalContextPaths,
      modelOverride,
    );

    this.persistentQuery = agentQuery({
      prompt: this.messageChannel,
      options,
    });

    if (this.pendingResumeAt === resumeAtMessageId) {
      this.pendingResumeAt = undefined;
    }
    this.attachPersistentQueryStdinErrorHandler(this.persistentQuery);

    this.startResponseConsumer();
    this.notifyReadyStateChange();
  }

  private attachPersistentQueryStdinErrorHandler(query: Query): void {
    const stdin = (query as { transport?: { processStdin?: NodeJS.WritableStream } }).transport?.processStdin;
    if (!stdin || typeof stdin.on !== 'function' || typeof stdin.once !== 'function') {
      return;
    }

    const handler = (error: NodeJS.ErrnoException) => {
      if (this.shuttingDown || this.isPipeError(error)) {
        return;
      }
      this.closePersistentQuery('stdin error');
    };

    stdin.on('error', handler);
    stdin.once('close', () => {
      stdin.removeListener('error', handler);
    });
  }

  private isPipeError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { code?: string; message?: string };
    return e.code === 'EPIPE' || (typeof e.message === 'string' && e.message.includes('EPIPE'));
  }

  /**
   * Closes the persistent query and cleans up resources.
   */
  closePersistentQuery(_reason?: string, options?: ClosePersistentQueryOptions): void {
    if (!this.persistentQuery) {
      return;
    }

    const preserveHandlers = options?.preserveHandlers ?? false;

    this.shuttingDown = true;

    // Close the message channel (ends the async iterable)
    this.messageChannel?.close();

    // Interrupt the query
    void this.persistentQuery.interrupt().catch(() => {
      // Silence abort/interrupt errors during shutdown
    });

    // Abort as backup
    this.queryAbortController?.abort();

    if (!preserveHandlers) {
      // Notify all handlers before clearing so generators don't hang forever.
      // This ensures queryViaPersistent() exits its while(!state.done) loop.
      for (const handler of this.responseHandlers) {
        handler.onDone();
      }
    }

    // Reset shuttingDown synchronously. The consumer loop sees shuttingDown=true
    // on its next iteration check (line 549) and breaks. The messageChannel.close()
    // above also terminates the for-await loop. Resetting here allows new queries
    // to proceed immediately without waiting for consumer loop teardown.
    this.shuttingDown = false;
    this.notifyReadyStateChange();

    // Clear state
    this.persistentQuery = null;
    this.messageChannel = null;
    this.queryAbortController = null;
    this.responseConsumerRunning = false;
    this.responseConsumerPromise = null;
    this.currentConfig = null;
    this.cachedSdkCommands = [];
    this.streamTransformState.clearAll();
    this.usageTransformState.clear();
    this._autoTurnBuffer = [];
    this._autoTurnSawStreamText = false;
    this._autoTurnSawStreamThinking = false;
    if (!preserveHandlers) {
      this.responseHandlers = [];
      this.currentAllowedTools = null;
    }

    // NOTE: Do NOT reset crashRecoveryAttempted here.
    // It's reset in queryViaPersistent after a successful message send,
    // or in resetSession/setSessionId when switching sessions.
    // Resetting it here would cause infinite restart loops on persistent errors.
  }

  /**
   * Checks if the persistent query needs to be restarted based on configuration changes.
   */
  private needsRestart(newConfig: PersistentQueryConfig): boolean {
    return QueryOptionsBuilder.needsRestart(this.currentConfig, newConfig);
  }

  /**
   * Builds configuration object for tracking changes.
   *
   * @param modelOverride - Optional per-turn model that beats `settings.model`.
   *   Pass the work-order model here so `currentConfig.model` accurately reflects
   *   the model the persistent query was started with, keeping applyDynamicUpdates
   *   correct for subsequent turns.
   * @param boundAgentPrompt - Optional bound-agent system prompt appendix. Changes
   *   to this value flip `systemPromptKey`, which `needsRestart` watches, so
   *   binding or unbinding an agent mid-conversation restarts the persistent query.
   */
  private buildPersistentQueryConfig(
    vaultPath: string,
    cliPath: string,
    externalContextPaths?: string[],
    modelOverride?: string,
    boundAgentPrompt?: string,
  ): PersistentQueryConfig {
    return QueryOptionsBuilder.buildPersistentQueryConfig(
      this.buildQueryOptionsContext(vaultPath, cliPath),
      externalContextPaths,
      modelOverride,
      boundAgentPrompt,
    );
  }

  /**
   * Builds the base query options context from current state.
   */
  private getScopedSettings(): SpecoratorSettings {
    return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      this.providerId,
    );
  }

  private buildQueryOptionsContext(vaultPath: string, cliPath: string): QueryOptionsContext {
    const customEnv = this.plugin.getResolvedEnvironmentVariables(this.providerId);
    const enhancedPath = getEnhancedPath(customEnv.PATH, cliPath);

    return {
      vaultPath,
      cliPath,
      settings: this.getScopedSettings(),
      customEnv,
      enhancedPath,
      mcpManager: this.mcpManager,
      pluginManager: this.requirePluginManager(),
      boundAgentPrompt: this.currentBoundAgentPrompt,
      boundAgentModel: this.currentBoundAgentModel,
    };
  }

  private requirePluginManager(): AppPluginManager {
    const pluginManager = this.pluginManager ?? this.getLegacyPluginDeps().pluginManager ?? null;
    if (!pluginManager) {
      throw new Error('Claude plugin manager is unavailable.');
    }
    return pluginManager;
  }

  private getAgentManager(): Pick<AppAgentManager, 'setBuiltinAgentNames'> | null {
    return this.agentManager ?? this.getLegacyPluginDeps().agentManager ?? null;
  }

  /**
   * Builds SDK options for the persistent query.
   *
   * @param modelOverride - Optional per-turn model that beats `settings.model`.
   *   Used when the persistent query is started for the first time so the CLI
   *   process receives the correct `--model` flag immediately.
   */
  private buildPersistentQueryOptions(
    vaultPath: string,
    cliPath: string,
    resumeSessionId?: string,
    resumeAtMessageId?: string,
    externalContextPaths?: string[],
    modelOverride?: string,
  ): Options {
    const baseContext = this.buildQueryOptionsContext(vaultPath, cliPath);
    const hooks = this.buildHooks();

    const ctx: PersistentQueryContext = {
      ...baseContext,
      abortController: this.queryAbortController ?? undefined,
      resume: resumeSessionId
        ? { sessionId: resumeSessionId, sessionAt: resumeAtMessageId, fork: this.pendingForkSession || undefined }
        : undefined,
      canUseTool: this.createApprovalCallback(),
      hooks,
      externalContextPaths,
      modelOverride,
    };

    return QueryOptionsBuilder.buildPersistentQueryOptions(ctx);
  }

  /**
   * Builds the hooks for SDK options.
   * Hooks need access to `this` for dynamic settings, so they're built here.
   */
  private buildHooks() {
    const hooks: Options['hooks'] = {};

    // Always register subagent hooks — closures resolve provider at execution time
    // so hooks work even when provider is set after the persistent query starts.
    hooks.Stop = [createStopSubagentHook(
      () => this.host.getSubagentState()
    )];

    return hooks;
  }

  /**
   * Starts the background consumer loop that routes chunks to handlers.
   */
  private startResponseConsumer(): void {
    if (this.responseConsumerRunning) {
      return;
    }

    this.responseConsumerRunning = true;

    // Track which query this consumer is for, to detect if we were replaced
    const queryForThisConsumer = this.persistentQuery;

    this.responseConsumerPromise = (async () => {
      if (!this.persistentQuery) return;

      try {
        for await (const message of this.persistentQuery) {
          if (this.shuttingDown) break;

          await this.routeMessage(message);
        }
      } catch (error) {
        await this.handleConsumerError(error, queryForThisConsumer);
      } finally {
        // Only clear the flag if this consumer wasn't replaced by a new one (e.g., after restart)
        // If ensureReady() restarted, it starts a new consumer which sets the flag true,
        // so we shouldn't clear it here.
        if (this.persistentQuery === queryForThisConsumer || this.persistentQuery === null) {
          this.responseConsumerRunning = false;
        }
      }
    })();
  }

  private async handleConsumerError(error: unknown, queryForThisConsumer: Query | null): Promise<void> {
    // Skip error handling if this consumer was replaced by a new one.
    // This prevents race conditions where the OLD consumer's error handler
    // interferes with the NEW handler after a restart (e.g., from applyDynamicUpdates).
    if (this.persistentQuery !== queryForThisConsumer && this.persistentQuery !== null) {
      return;
    }

    // Skip restart if cold-start is in progress (it will handle session capture)
    if (this.shuttingDown || this.coldStartInProgress) {
      return;
    }

    const handler = this.responseHandlers[this.responseHandlers.length - 1];
    const errorInstance = error instanceof Error ? error : new Error(String(error));
    const messageToReplay = this.lastSentMessage;

    if (!this.crashRecoveryAttempted && messageToReplay && handler && !handler.sawAnyChunk) {
      this.crashRecoveryAttempted = true;
      await this.replayLastMessageAfterCrash(messageToReplay, handler, error, errorInstance);
      return;
    }

    // Notify active handler of error
    if (handler) {
      handler.onError(errorInstance);
    }

    // Crash recovery: restart persistent query to prepare for next user message.
    if (this.crashRecoveryAttempted) {
      return;
    }
    this.crashRecoveryAttempted = true;
    try {
      await this.ensureReady({ force: true });
    } catch (restartError) {
      // If restart failed due to session expiration, invalidate session
      // so next query triggers noSessionButHasHistory → history rebuild
      if (isSessionExpiredError(restartError)) {
        this.sessionManager.invalidateSession();
      }
      // Restart failed - next query will start fresh.
    }
  }

  private async replayLastMessageAfterCrash(
    messageToReplay: SDKUserMessage,
    handler: ResponseHandler,
    cause: unknown,
    errorInstance: Error,
  ): Promise<void> {
    try {
      await this.ensureReady({ force: true, preserveHandlers: true });
      if (!this.messageChannel) {
        throw new Error('Persistent query restart did not create message channel', {
          cause,
        });
      }
      await this.applyDynamicUpdates(this.lastSentQueryOptions ?? undefined, { preserveHandlers: true });
      this.messageChannel.enqueue(messageToReplay);
    } catch (restartError) {
      // If restart failed due to session expiration, invalidate session
      // so next query triggers noSessionButHasHistory → history rebuild
      if (isSessionExpiredError(restartError)) {
        this.sessionManager.invalidateSession();
      }
      handler.onError(errorInstance);
    }
  }

  /** @param modelOverride - Optional model override for cold-start queries */
  private getTransformOptions(
    modelOverride?: string,
    streamState = this.streamTransformState,
    usageState = this.usageTransformState,
  ) {
    const settings = this.getScopedSettings();
    return {
      intendedModel: modelOverride ?? settings.model,
      // Merge per-model contextWindow overrides from the customModels catalog
      // into the legacy limits map so the transform sees catalog-defined limits
      // without restructuring the deeper usage pipeline.
      customContextLimits: mergeCustomModelContextLimits(
        settings.customContextLimits,
        getClaudeProviderSettings(settings).customModels,
      ),
      streamState,
      usageState,
    };
  }

  /**
   * Routes an SDK message to the active response handler.
   *
   * Design: Only one handler exists at a time because MessageChannel enforces
   * single-turn processing. When a turn is active, new messages are queued/merged.
   * The next message only dequeues after onTurnComplete(), which calls onDone()
   * on the current handler. A new handler is registered only when the next query starts.
   */
  private async routeMessage(message: SDKMessage): Promise<void> {
    // Note: Session expiration errors are handled in catch blocks (queryViaSDK, handleAbort)
    // The SDK throws errors as exceptions, not as message types

    // Safe to use last handler - design guarantees single handler at a time
    const handler = this.responseHandlers[this.responseHandlers.length - 1];
    const autoTurnBufferStartLength = this._autoTurnBuffer.length;

    // Transform SDK message to StreamChunks
    for (const event of transformSDKMessage(message, this.getTransformOptions())) {
      this.markRoutedStreamContent(message, event, handler);

      if (isSessionInitEvent(event)) {
        this.handleRoutedSessionInit(event);
      } else if (isContextWindowEvent(event)) {
        this.deliverRoutedContextWindow(event, handler);
      } else if (isStreamChunk(event)) {
        this.deliverRoutedStreamChunk(message, event, handler);
      }
    }

    await this.finishRoutedMessage(message, handler, autoTurnBufferStartLength);
  }

  private markRoutedStreamContent(
    message: SDKMessage,
    event: TransformEvent,
    handler: ResponseHandler | undefined,
  ): void {
    noteVisibleStreamContent(message, event, {
      onText: () => {
        if (handler) {
          handler.markStreamTextSeen();
        } else {
          this._autoTurnSawStreamText = true;
        }
      },
      onThinking: () => {
        if (handler) {
          handler.markStreamThinkingSeen();
        } else {
          this._autoTurnSawStreamThinking = true;
        }
      },
    });
  }

  private handleRoutedSessionInit(event: SessionInitEvent): void {
    // Fork: suppress needsHistoryRebuild since SDK returns a different session ID by design
    const wasFork = this.pendingForkSession;
    this.sessionManager.captureSession(event.sessionId);
    if (wasFork) {
      this.sessionManager.clearHistoryRebuild();
      this.pendingForkSession = false;
    }
    this.messageChannel?.setSessionId(event.sessionId);
    if (event.agents) {
      try { this.getAgentManager()?.setBuiltinAgentNames(event.agents); } catch { /* non-critical */ }
    }
    if (event.permissionMode) {
      try { this.host.permissionModeSync(event.permissionMode); } catch { /* non-critical */ }
    }
    // Cache SDK commands on init (SDK already scans the vault).
    // Pass the current query instance so late completions from a dead query
    // cannot overwrite the active cache after a restart or shutdown.
    void this.fetchAndCacheCommands(this.persistentQuery);
  }

  private deliverRoutedContextWindow(event: ContextWindowEvent, handler: ResponseHandler | undefined): void {
    const usageChunk = this.updateBufferedUsageContextWindow(event.contextWindow);
    if (!usageChunk) {
      return;
    }
    if (handler) {
      handler.onChunk(usageChunk);
    } else {
      this._autoTurnBuffer.push(usageChunk);
    }
  }

  // Dedup: SDK delivers text via stream_events (incremental) AND the assistant message
  // (complete). Skip the assistant message text if stream text was already seen.
  private isDuplicateAssistantContent(
    message: SDKMessage,
    event: StreamChunk,
    handler: ResponseHandler | undefined,
  ): boolean {
    if (message.type !== 'assistant') {
      return false;
    }
    if (event.type === 'text') {
      return handler ? handler.sawStreamText : this._autoTurnSawStreamText;
    }
    if (event.type === 'thinking') {
      return handler ? handler.sawStreamThinking : this._autoTurnSawStreamThinking;
    }
    return false;
  }

  private deliverRoutedStreamChunk(
    message: SDKMessage,
    event: StreamChunk,
    handler: ResponseHandler | undefined,
  ): void {
    if (this.isDuplicateAssistantContent(message, event, handler)) {
      return;
    }

    // SDK auto-approves EnterPlanMode (checkPermissions → allow),
    // so canUseTool is never called. Detect the tool_use in the stream
    // and fire the sync callback to update the UI.
    if (event.type === 'tool_use' && event.name === TOOL_ENTER_PLAN_MODE) {
      if (this.currentConfig) {
        this.currentConfig.permissionMode = 'plan';
        this.currentConfig.sdkPermissionMode = 'plan';
      }
      try { this.host.permissionModeSync('plan'); } catch { /* non-critical */ }
    }

    const normalizedChunk = event.type === 'usage'
      ? this.bufferUsageChunk({ ...event, sessionId: this.sessionManager.getSessionId() })
      : event;

    if (handler) {
      handler.onChunk(normalizedChunk);
    } else {
      // No handler — buffer for auto-triggered turn (e.g., task-notification delivery)
      this._autoTurnBuffer.push(normalizedChunk);
    }
  }

  private async finishRoutedMessage(
    message: SDKMessage,
    handler: ResponseHandler | undefined,
    autoTurnBufferStartLength: number,
  ): Promise<void> {
    if (
      !handler
      && message.type === 'system'
      && message.subtype === 'task_notification'
      && this._autoTurnBuffer.length > autoTurnBufferStartLength
    ) {
      await this.flushAutoTurnBuffer();
    }

    if (message.type === 'assistant' && message.uuid) {
      this.recordTurnMetadata({ assistantMessageId: message.uuid });
    }

    // Check for turn completion
    if (isTurnCompleteMessage(message)) {
      // Signal turn complete to message channel
      this.messageChannel?.onTurnComplete();

      // Notify handler
      if (handler) {
        handler.resetStreamText();
        handler.resetStreamThinking();
        handler.onDone();
      } else {
        await this.flushAutoTurnBuffer();
      }
    }
  }

  private async flushAutoTurnBuffer(): Promise<void> {
    this._autoTurnSawStreamText = false;
    this._autoTurnSawStreamThinking = false;
    if (this._autoTurnBuffer.length === 0) {
      return;
    }

    // Flush buffered chunks from auto-triggered turn (no handler was registered)
    const chunks = [...this._autoTurnBuffer];
    const metadata = this.consumeTurnMetadata();
    this._autoTurnBuffer = [];
    try {
      await this.host.autoTurn({ chunks, metadata });
    } catch {
      new Notice(t('provider.claude.task.resultRenderFailed'));
    }
  }

  private registerResponseHandler(handler: ResponseHandler): void {
    this.responseHandlers.push(handler);
  }

  private unregisterResponseHandler(handlerId: string): void {
    const idx = this.responseHandlers.findIndex(h => h.id === handlerId);
    if (idx >= 0) {
      this.responseHandlers.splice(idx, 1);
    }
  }

  private normalizeTurnInvocation(
    turnOrPrompt: PreparedChatTurn | string,
    imagesOrHistory?: ImageAttachment[] | ChatMessage[],
    conversationHistoryOrQueryOptions?: ChatMessage[] | QueryOptions,
    legacyQueryOptions?: QueryOptions,
  ): {
    request: ChatTurnRequest;
    encodedTurn: PreparedChatTurn;
    conversationHistory?: ChatMessage[];
    queryOptions?: QueryOptions;
  } {
    if (typeof turnOrPrompt !== 'string') {
      const turn = turnOrPrompt;
      const conversationHistory = isChatMessageArray(imagesOrHistory)
        ? imagesOrHistory
        : undefined;
      const explicitQueryOptions = isChatMessageArray(conversationHistoryOrQueryOptions)
        ? undefined
        : conversationHistoryOrQueryOptions;
      return {
        request: turn.request,
        encodedTurn: turn,
        conversationHistory,
        queryOptions: buildQueryOptionsFromTurnRequest(turn.request, turn, explicitQueryOptions),
      };
    }

    const images = isImageAttachmentArray(imagesOrHistory) ? imagesOrHistory : undefined;
    const conversationHistory = isChatMessageArray(conversationHistoryOrQueryOptions)
      ? conversationHistoryOrQueryOptions
      : undefined;
    const queryOptions = isChatMessageArray(conversationHistoryOrQueryOptions)
      ? legacyQueryOptions
      : conversationHistoryOrQueryOptions ?? legacyQueryOptions;
    const request = buildLegacyTurnRequest(turnOrPrompt, images, queryOptions);
    const encodedTurn = this.prepareTurn(request);

    return {
      request,
      encodedTurn,
      conversationHistory,
      queryOptions: buildQueryOptionsFromTurnRequest(request, encodedTurn, queryOptions),
    };
  }

  isPersistentQueryActive(): boolean {
    return this.persistentQuery !== null && !this.shuttingDown;
  }

  /**
   * Sends a query to Claude and streams the response.
   *
   * Query selection:
   * - Persistent query: default chat conversation
   * - Cold-start query: only when forceColdStart is set
   */
  query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions,
  ): AsyncGenerator<StreamChunk>;
  query(
    prompt: string,
    images?: ImageAttachment[],
    conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions,
  ): AsyncGenerator<StreamChunk>;
  async *query(
    turnOrPrompt: PreparedChatTurn | string,
    imagesOrHistory?: ImageAttachment[] | ChatMessage[],
    conversationHistoryOrQueryOptions?: ChatMessage[] | QueryOptions,
    legacyQueryOptions?: QueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const normalized = this.normalizeTurnInvocation(
      turnOrPrompt,
      imagesOrHistory,
      conversationHistoryOrQueryOptions,
      legacyQueryOptions,
    );
    const prompt = normalized.encodedTurn.prompt;
    const images = normalized.request.images;
    const conversationHistory = normalized.conversationHistory;
    const queryOptions = normalized.queryOptions;
    const log = this.plugin.logger.scope('claude.runtime');
    if (log.isEnabled('debug')) {
      log.debug('query start', {
        hasHistory: (conversationHistory?.length ?? 0) > 0,
        sessionId: this.sessionManager.getSessionId() ?? null,
      });
    }

    const env = this.resolveQueryEnvironment();
    if (!env.ok) {
      yield { type: 'error', content: env.error };
      return;
    }

    const { promptToSend, forceColdStart } = this.prepareQueryPrompt(prompt, conversationHistory);

    const effectiveQueryOptions = forceColdStart
      ? { ...queryOptions, forceColdStart: true }
      : queryOptions;

    if (forceColdStart) {
      // Set flag BEFORE closing to prevent consumer error from triggering restart
      this.coldStartInProgress = true;
      this.closePersistentQuery('session invalidated');
    }

    // Determine query path: persistent vs cold-start
    const shouldUsePersistent = !effectiveQueryOptions?.forceColdStart;

    if (shouldUsePersistent) {
      const handled = yield* this.runPersistentTurn({
        prompt,
        promptToSend,
        images,
        conversationHistory,
        vaultPath: env.vaultPath,
        cliPath: env.cliPath,
        queryOptions,
        effectiveQueryOptions,
      });
      if (handled) {
        return;
      }
    }

    // Cold-start path (existing logic)
    // Set flag to prevent consumer error restarts from interfering
    this.coldStartInProgress = true;
    this.abortController = new AbortController();

    try {
      yield* this.queryViaSDK(promptToSend, env.vaultPath, env.cliPath, images, effectiveQueryOptions);
    } catch (error) {
      if (isSessionExpiredError(error) && conversationHistory && conversationHistory.length > 0) {
        yield* this.retryColdStartWithHistory(
          prompt,
          images,
          env.vaultPath,
          env.cliPath,
          conversationHistory,
          effectiveQueryOptions,
        );
        return;
      }

      log.error('cold-start query failed', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    } finally {
      this.coldStartInProgress = false;
      this.abortController = null;
    }
  }

  private resolveQueryEnvironment():
    | { ok: true; vaultPath: string; cliPath: string }
    | { ok: false; error: string } {
    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) {
      return { ok: false, error: 'Could not determine vault path' };
    }

    const cliPath = this.plugin.getResolvedProviderCliPath('claude');
    if (!cliPath) {
      return { ok: false, error: 'Claude CLI not found. Please install Claude Code CLI.' };
    }

    const customEnv = this.plugin.getResolvedEnvironmentVariables(this.providerId);
    const enhancedPath = getEnhancedPath(customEnv.PATH, cliPath);
    const missingNodeError = getMissingNodeError(cliPath, enhancedPath);
    if (missingNodeError) {
      return { ok: false, error: missingNodeError };
    }

    return { ok: true, vaultPath, cliPath };
  }

  /** Rebuild history if needed before choosing persistent vs cold-start. */
  private prepareQueryPrompt(
    prompt: string,
    conversationHistory?: ChatMessage[],
  ): { promptToSend: string; forceColdStart: boolean } {
    let promptToSend = prompt;
    let forceColdStart = false;

    // Clear interrupted flag - persistent query handles interruption gracefully,
    // no need to force cold-start just because user cancelled previous response
    if (this.sessionManager.wasInterrupted()) {
      this.sessionManager.clearInterrupted();
    }

    // Session mismatch recovery: SDK returned a different session ID (context lost)
    // Inject history to restore context without forcing cold-start
    if (this.sessionManager.needsHistoryRebuild() && conversationHistory && conversationHistory.length > 0) {
      promptToSend = buildHistoryContextPrompt(prompt, conversationHistory);
      this.sessionManager.clearHistoryRebuild();
    }

    const noSessionButHasHistory = !this.sessionManager.getSessionId() &&
      conversationHistory && conversationHistory.length > 0;

    if (noSessionButHasHistory) {
      promptToSend = buildHistoryContextPrompt(prompt, conversationHistory);

      // Note: Do NOT call invalidateSession() here. The cold-start will capture
      // a new session ID anyway, and invalidating would break any persistent query
      // restart that happens during the cold-start (causing SESSION MISMATCH).
      forceColdStart = true;
    }

    return { promptToSend, forceColdStart };
  }

  /** Returns true when the turn was fully handled; false falls through to cold-start. */
  private async *runPersistentTurn(ctx: PersistentTurnContext): AsyncGenerator<StreamChunk, boolean> {
    // Start persistent query if not running.
    // Pass the per-turn model override so the CLI process is spawned with
    // the correct --model flag immediately, without relying on setModel()
    // which only takes effect at turn boundaries.
    if (!this.persistentQuery && !this.shuttingDown) {
      await this.startPersistentQuery(
        ctx.vaultPath,
        ctx.cliPath,
        this.sessionManager.getSessionId() ?? undefined,
        undefined,
        ctx.queryOptions?.model,
      );
    }

    if (!this.persistentQuery || this.shuttingDown) {
      return false;
    }

    // Use persistent query path
    try {
      yield* this.queryViaPersistent(ctx.promptToSend, ctx.images, ctx.vaultPath, ctx.cliPath, ctx.effectiveQueryOptions);
      return true;
    } catch (error) {
      if (isSessionExpiredError(error) && ctx.conversationHistory && ctx.conversationHistory.length > 0) {
        this.coldStartInProgress = true;
        this.abortController = new AbortController();

        try {
          yield* this.retryColdStartWithHistory(
            ctx.prompt,
            ctx.images,
            ctx.vaultPath,
            ctx.cliPath,
            ctx.conversationHistory,
            ctx.effectiveQueryOptions,
          );
        } finally {
          this.coldStartInProgress = false;
          this.abortController = null;
        }
        return true;
      }

      this.plugin.logger.scope('claude.runtime').error('persistent query failed', error);
      throw error;
    }
  }

  /** Session-expired fallback: rebuild context from history and retry via cold-start. */
  private async *retryColdStartWithHistory(
    prompt: string,
    images: ImageAttachment[] | undefined,
    vaultPath: string,
    cliPath: string,
    conversationHistory: ChatMessage[],
    queryOptions?: QueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.sessionManager.invalidateSession();
    const retryRequest = buildHistoryRebuildRequest(prompt, conversationHistory);

    try {
      yield* this.queryViaSDK(
        retryRequest.prompt,
        vaultPath,
        cliPath,
        // Use current message's images, fallback to history images
        images ?? retryRequest.images,
        queryOptions,
      );
    } catch (retryError) {
      const msg = retryError instanceof Error ? retryError.message : 'Unknown error';
      yield { type: 'error', content: msg };
    }
  }

  /**
   * Query via persistent query (Phase 1.5).
   * Uses the message channel to send messages without cold-start latency.
   */
  private async *queryViaPersistent(
    prompt: string,
    images: ImageAttachment[] | undefined,
    vaultPath: string,
    cliPath: string,
    queryOptions?: QueryOptions
  ): AsyncGenerator<StreamChunk> {
    this.resetTurnMetadata();

    if (!this.persistentQuery || !this.messageChannel) {
      // Fallback to cold-start if persistent query not available
      yield* this.queryViaSDK(prompt, vaultPath, cliPath, images, queryOptions);
      return;
    }

    // Capture bound-agent state before applyDynamicUpdates so buildQueryOptionsContext
    // sees the correct values when a restart is triggered inside maybeRestart.
    this.currentBoundAgentPrompt = queryOptions?.boundAgentPrompt;
    this.currentBoundAgentModel = queryOptions?.boundAgentModel;
    this.currentBoundAgentTools = queryOptions?.boundAgentTools;

    await this.applyTurnToolRestrictions(queryOptions);

    // Check if applyDynamicUpdates triggered a restart that failed
    // (e.g., CLI path not found, vault path missing)
    if (!this.persistentQuery || !this.messageChannel || !this.responseConsumerRunning) {
      yield* this.queryViaSDK(prompt, vaultPath, cliPath, images, queryOptions);
      return;
    }

    const message = this.buildSDKUserMessage(prompt, images);

    // Create a promise-based handler to yield chunks
    const { state, handler, handlerId } = createStreamingTurnHandler();

    this.registerResponseHandler(handler);

    try {
      // Track message for crash recovery (Phase 1.3)
      this.lastSentMessage = message;
      this.lastSentQueryOptions = queryOptions ?? null;
      this.crashRecoveryAttempted = false;

      // Enqueue the message with race condition protection
      // The channel could close between our null check above and this call
      if (!tryEnqueueTurnMessage(this.messageChannel, message)) {
        yield* this.queryViaSDK(prompt, vaultPath, cliPath, images, queryOptions);
        return;
      }
      this.recordTurnMetadata({
        userMessageId: message.uuid ?? undefined,
        wasSent: true,
      });

      yield* drainStreamingTurn(state);

      // Check if an error occurred (assigned in onError callback)
      if (state.error) {
        // Re-throw session expired errors for outer retry logic to handle
        if (isSessionExpiredError(state.error)) {
          throw state.error;
        }
        yield { type: 'error', content: state.error.message };
      }

      // Clear message tracking after completion
      this.lastSentMessage = null;
      this.lastSentQueryOptions = null;

      yield { type: 'done' };
    } finally {
      this.unregisterResponseHandler(handlerId);
      this.currentAllowedTools = null;
    }
  }

  private async applyTurnToolRestrictions(queryOptions?: QueryOptions): Promise<void> {
    // Set allowed tools for canUseTool enforcement
    // undefined = no restriction, [] = no tools, [...] = restricted
    this.currentAllowedTools = resolveTurnAllowedTools(queryOptions?.allowedTools);

    // Save allowedTools before applyDynamicUpdates - restart would clear it
    const savedAllowedTools = this.currentAllowedTools;

    // Apply dynamic updates before sending (Phase 1.6)
    await this.applyDynamicUpdates(queryOptions);

    // Restore allowedTools in case restart cleared it
    this.currentAllowedTools = savedAllowedTools;
  }

  private buildSDKUserMessage(prompt: string, images?: ImageAttachment[]): SDKUserMessage {
    return buildClaudeSDKUserMessage(
      prompt,
      this.sessionManager.getSessionId() || '',
      images,
    );
  }

  /**
   * Apply dynamic updates to the persistent query before sending a message (Phase 1.6).
   */
  private async applyDynamicUpdates(
    queryOptions?: QueryOptions,
    restartOptions?: ClosePersistentQueryOptions,
    allowRestart = true
  ): Promise<void> {
    await applyClaudeDynamicUpdates(
      {
        getPersistentQuery: () => this.persistentQuery,
        getCurrentConfig: () => this.currentConfig,
        mutateCurrentConfig: (mutate) => {
          if (this.currentConfig) {
            mutate(this.currentConfig);
          }
        },
        getVaultPath: () => this.vaultPath,
        getCliPath: () => this.plugin.getResolvedProviderCliPath('claude'),
        getScopedSettings: () => this.getScopedSettings(),
        // Read the Claude-projected permission mode rather than the raw global
        // setting. The global reflects whichever provider is currently active in
        // the settings panel; when a non-Claude provider (e.g. Codex) is active
        // in YOLO mode, `plugin.settings.permissionMode` carries that provider's
        // value and would incorrectly override Claude's own saved safe-mode.
        getPermissionMode: () => this.getScopedSettings().permissionMode as PermissionMode,
        resolveSDKPermissionMode: (mode) => this.resolveSDKPermissionMode(mode),
        mcpManager: this.mcpManager,
        getSpecoratorToolServer: this.plugin.getSpecoratorToolServer
          ? () => this.plugin.getSpecoratorToolServer!(this.currentBoundAgentTools)
          : undefined,
        getSpecoratorToolKey: () => this.plugin.getSpecoratorToolKey?.(this.currentBoundAgentTools) ?? '',
        buildPersistentQueryConfig: (vaultPath, cliPath, externalContextPaths, boundAgentPrompt) =>
          this.buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths, undefined, boundAgentPrompt),
        needsRestart: (newConfig) => this.needsRestart(newConfig),
        ensureReady: (options) => this.ensureReady(options),
        setCurrentExternalContextPaths: (paths) => {
          this.currentExternalContextPaths = paths;
        },
        notifyFailure: (message) => {
          new Notice(message);
        },
      },
      queryOptions,
      restartOptions,
      allowRestart,
    );
  }

  private buildPromptWithImages(prompt: string, images?: ImageAttachment[]): ReturnType<typeof buildClaudePromptWithImages> {
    return buildClaudePromptWithImages(prompt, images);
  }

  private async *queryViaSDK(
    prompt: string,
    cwd: string,
    cliPath: string,
    images?: ImageAttachment[],
    queryOptions?: QueryOptions
  ): AsyncGenerator<StreamChunk> {
    this.resetTurnMetadata();
    // Sync bound-agent state so buildQueryOptionsContext picks up the current values
    // on the cold-start path (covers direct cold-starts and restarts from queryViaPersistent).
    this.currentBoundAgentPrompt = queryOptions?.boundAgentPrompt;
    this.currentBoundAgentModel = queryOptions?.boundAgentModel;
    this.currentBoundAgentTools = queryOptions?.boundAgentTools;
    const selectedModel = queryOptions?.model || this.getScopedSettings().model;

    this.sessionManager.setPendingModel(selectedModel);
    this.vaultPath = cwd;

    const queryPrompt = this.buildPromptWithImages(prompt, images);
    const options = this.buildColdStartOptions(prompt, cwd, cliPath, queryOptions);

    yield* this.vetColdStartMcpServers(options);

    const state: ColdStartStreamState = {
      selectedModel,
      sawStreamText: false,
      sawStreamThinking: false,
      streamSessionId: this.sessionManager.getSessionId(),
      streamState: createTransformStreamState(),
      usageState: createTransformUsageState(),
    };

    try {
      const response = agentQuery({ prompt: queryPrompt, options });
      this.recordTurnMetadata({ wasSent: true });

      for await (const message of response) {
        if (this.abortController?.signal.aborted) {
          await response.interrupt();
          break;
        }

        yield* this.projectColdStartMessage(message, state);
      }
    } catch (error) {
      // Re-throw session expired errors for outer retry logic to handle
      if (isSessionExpiredError(error)) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    } finally {
      this.sessionManager.clearPendingModel();
      this.currentAllowedTools = null; // Clear tool restriction after query
    }

    yield { type: 'done' };
  }

  private buildColdStartOptions(
    prompt: string,
    cwd: string,
    cliPath: string,
    queryOptions?: QueryOptions,
  ): Options {
    const baseContext = this.buildQueryOptionsContext(cwd, cliPath);
    const externalContextPaths = queryOptions?.externalContextPaths || [];
    const hooks = this.buildHooks();
    const hasEditorContext = prompt.includes('<editor_selection');

    const ctx: ColdStartQueryContext = {
      ...baseContext,
      abortController: this.abortController ?? undefined,
      sessionId: this.sessionManager.getSessionId() ?? undefined,
      modelOverride: queryOptions?.model,
      canUseTool: this.createApprovalCallback(),
      hooks,
      mcpMentions: queryOptions?.mcpMentions,
      enabledMcpServers: queryOptions?.enabledMcpServers,
      allowedTools: resolveColdStartAllowedTools(queryOptions?.allowedTools),
      hasEditorContext,
      externalContextPaths,
      getSpecoratorToolServer: this.plugin.getSpecoratorToolServer
        ? () => this.plugin.getSpecoratorToolServer!(this.currentBoundAgentTools)
        : undefined,
    };

    return QueryOptionsBuilder.buildColdStartQueryOptions(ctx);
  }

  private async *vetColdStartMcpServers(options: Options): AsyncGenerator<StreamChunk> {
    // SECURITY (SEC-D): vet URL-based MCP servers before the config reaches
    // the Claude CLI — the settings Test button is not on this path. Unsafe
    // servers are dropped (fail closed) instead of failing the turn.
    if (!options.mcpServers || Object.keys(options.mcpServers).length === 0) {
      return;
    }
    const vetted = await vetActiveServersForRuntime(options.mcpServers);
    options.mcpServers = vetted.safe;
    for (const entry of vetted.dropped) {
      yield {
        type: 'notice',
        content: `MCP server "${entry.name}" was not activated: ${entry.reason}`,
        level: 'warning',
      };
    }
  }

  private *projectColdStartMessage(
    message: SDKMessage,
    state: ColdStartStreamState,
  ): Generator<StreamChunk> {
    const transformOptions = this.getTransformOptions(state.selectedModel, state.streamState, state.usageState);

    for (const event of transformSDKMessage(message, transformOptions)) {
      noteVisibleStreamContent(message, event, {
        onText: () => {
          state.sawStreamText = true;
        },
        onThinking: () => {
          state.sawStreamThinking = true;
        },
      });

      if (isSessionInitEvent(event)) {
        this.sessionManager.captureSession(event.sessionId);
        state.streamSessionId = event.sessionId;
      } else if (isContextWindowEvent(event)) {
        const usageChunk = this.updateBufferedUsageContextWindow(event.contextWindow);
        if (usageChunk) {
          yield usageChunk;
        }
      } else if (isStreamChunk(event)) {
        yield* this.projectColdStartChunk(message, event, state);
      }
    }

    if (message.type === 'assistant' && message.uuid) {
      this.recordTurnMetadata({ assistantMessageId: message.uuid });
    }

    if (message.type === 'result') {
      state.sawStreamText = false;
      state.sawStreamThinking = false;
    }
  }

  private *projectColdStartChunk(
    message: SDKMessage,
    event: StreamChunk,
    state: ColdStartStreamState,
  ): Generator<StreamChunk> {
    if (message.type === 'assistant' && state.sawStreamText && event.type === 'text') {
      return;
    }
    if (message.type === 'assistant' && state.sawStreamThinking && event.type === 'thinking') {
      return;
    }
    if (event.type === 'usage') {
      yield this.bufferUsageChunk({ ...event, sessionId: state.streamSessionId });
    } else {
      yield event;
    }
  }

  cancel() {
    this.host.dismissApproval();

    if (this.abortController) {
      this.abortController.abort();
      this.sessionManager.markInterrupted();
    }

    // Interrupt persistent query (Phase 1.9)
    if (this.persistentQuery && !this.shuttingDown) {
      void this.persistentQuery.interrupt().catch(() => {
        // Silence abort/interrupt errors
      });
    }
  }

  /**
   * Reset the conversation session.
   * Closes the persistent query since session is changing.
   */
  resetSession() {
    // Close persistent query (new session will use cold-start resume)
    this.closePersistentQuery('session reset');

    // Reset crash recovery for fresh start
    this.crashRecoveryAttempted = false;

    // Clear bound-agent state so the next conversation starts without stale overrides
    this.currentBoundAgentPrompt = undefined;
    this.currentBoundAgentModel = undefined;
    this.currentBoundAgentTools = undefined;

    this.sessionManager.reset();
  }

  getSessionId(): string | null {
    return this.sessionManager.getSessionId();
  }

  /** Consume session invalidation flag for persistence updates. */
  consumeSessionInvalidation(): boolean {
    return this.sessionManager.consumeInvalidation();
  }

  /**
   * Check if the service is ready (persistent query is active).
   * Used to determine if SDK skills are available.
   */
  isReady(): boolean {
    return this.isPersistentQueryActive();
  }

  /**
   * Get supported commands (SDK skills).
   * Returns cached commands populated on system/init. Falls back to a fresh
   * supportedCommands() call if the cache is empty (e.g., dropdown opened
   * before the first init event).
   */
  async getSupportedCommands(): Promise<SlashCommand[]> {
    if (this.cachedSdkCommands.length > 0) {
      return this.cachedSdkCommands;
    }
    if (!this.persistentQuery) {
      return [];
    }
    return this.fetchAndCacheCommands(this.persistentQuery);
  }

  /**
   * Fetches commands from the SDK and caches them. Called on system/init
   * (fire-and-forget) and as a fallback from getSupportedCommands().
   */
  private async fetchAndCacheCommands(query: Query | null): Promise<SlashCommand[]> {
    if (!query) return [];
    try {
      const sdkCommands: SDKSlashCommand[] = await query.supportedCommands();
      const mappedCommands = sdkCommands.map((cmd) => ({
        id: `sdk:${cmd.name}`,
        name: cmd.name,
        description: cmd.description,
        argumentHint: cmd.argumentHint,
        content: '',
        source: 'sdk' as const,
      }));
      if (this.persistentQuery !== query) {
        return this.cachedSdkCommands;
      }
      this.cachedSdkCommands = mappedCommands;
      return this.cachedSdkCommands;
    } catch {
      return [];
    }
  }

  /**
   * Set the session ID (for restoring from saved conversation).
   * Closes persistent query synchronously if session is changing, then ensures query is ready.
   *
   * @param id - Session ID to restore, or null for new session
   * @param externalContextPaths - External context paths for the session (prevents stale contexts)
   */
  setSessionId(id: string | null, externalContextPaths?: string[]): void {
    const currentId = this.sessionManager.getSessionId();
    const sessionChanged = currentId !== id;

    // Close synchronously when session changes
    if (sessionChanged) {
      this.closePersistentQuery('session switch');
      this.crashRecoveryAttempted = false;
      // Clear bound-agent state so the new conversation starts without stale overrides.
      // The correct bound-agent values are threaded per-turn from queryOptions.
      this.currentBoundAgentPrompt = undefined;
      this.currentBoundAgentModel = undefined;
      this.currentBoundAgentTools = undefined;
    }

    this.sessionManager.setSessionId(id, this.getScopedSettings().model);

    // Track external context paths for when the runtime starts on demand
    if (externalContextPaths !== undefined) {
      this.currentExternalContextPaths = externalContextPaths;
    }

    // Passive: do NOT call ensureReady() here.
    // Runtime starts on demand when query() is called.
  }

  /**
   * Cleanup resources (Phase 5).
   * Called on plugin unload to close persistent query and abort any cold-start query.
   */
  cleanup() {
    // Close persistent query
    this.closePersistentQuery('plugin cleanup');

    // Cancel any in-flight cold-start query
    this.cancel();
    this.resetSession();
  }

  async rewindFiles(userMessageId: string, dryRun?: boolean): Promise<RewindFilesResult> {
    if (!this.persistentQuery) throw new Error('No active query');
    if (this.shuttingDown) throw new Error('Service is shutting down');
    return this.persistentQuery.rewindFiles(userMessageId, { dryRun });
  }

  async rewind(
    userMessageId: string,
    assistantMessageId: string,
    mode: ChatRewindMode = 'code-and-conversation',
  ): Promise<ChatRewindResult> {
    return executeClaudeRewind(userMessageId, {
      assistantMessageId,
      mode,
      rewindFiles: (id, dryRun) => this.rewindFiles(id, dryRun),
      closePersistentQuery: (reason) => this.closePersistentQuery(reason),
      setPendingResumeAt: (resumeAt) => {
        this.pendingResumeAt = resumeAt;
      },
      vaultPath: this.vaultPath,
    });
  }

  private createApprovalCallback(): CanUseTool {
    return createClaudeApprovalCallback({
      getAllowedTools: () => this.currentAllowedTools,
      host: this.host,
      // Same projection fix as applyDynamicUpdates: read the Claude-projected
      // mode so ExitPlanMode restores the correct post-plan permission level.
      getPermissionMode: () => this.getScopedSettings().permissionMode as PermissionMode,
      resolveSDKPermissionMode: (mode) => this.resolveSDKPermissionMode(mode),
      syncPermissionMode: (mode, sdkMode) => {
        if (this.currentConfig) {
          this.currentConfig.permissionMode = mode;
          this.currentConfig.sdkPermissionMode = sdkMode;
        }
      },
    });
  }

  private resolveSDKPermissionMode(mode: PermissionMode): SDKPermissionMode {
    return QueryOptionsBuilder.resolveClaudeSdkPermissionMode(
      mode,
      getClaudeProviderSettings(this.plugin.settings).safeMode,
    );
  }
}
