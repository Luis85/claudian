import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import { serializeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type {
  ProviderCapabilities,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { RuntimeHost } from '../../../core/runtime/RuntimeHost';
import type {
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
  SessionUpdateResult,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import type { PluginContext } from '../../../core/types/PluginContext';
import { asSettingsBag } from '../../../core/types/settings';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import type {
  AcpJsonRpcTransport,
  AcpSubprocess} from '../../acp';
import {
  AcpClientConnection,
  type AcpNormalizedUpdate,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionConfigOption,
  type AcpSessionModelState,
  type AcpSessionModeState,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  type AcpUsage,
  type AcpUsageUpdate,
  type AcpWriteTextFileRequest,
  buildAcpUsageInfo,
  extractAcpSessionModelState,
  extractAcpSessionModeState,
  extractAcpSessionThoughtLevelState,
  readWorkspaceTextFile,
  resolveWorkspaceScopedPath,
} from '../../acp';
import { OPENCODE_PROVIDER_CAPABILITIES } from '../capabilities';
import { updateOpencodeDiscoveryState } from '../discoveryState';
import {
  sameModes,
} from '../internal/compareCollections';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
import {
  decodeOpencodeModelId,
  encodeOpencodeModelId,
  isOpencodeModelSelectionId,
  normalizeOpencodeDiscoveredModels,
  normalizeOpencodeModelVariants,
  OPENCODE_DEFAULT_THINKING_LEVEL,
  OPENCODE_SYNTHETIC_MODEL_ID,
  type OpencodeDiscoveredModel,
  type OpencodeModelVariant,
  resolveOpencodeBaseModelRawId,
} from '../models';
import {
  getManagedOpencodeModes,
  isManagedOpencodeModeId,
  normalizeOpencodeAvailableModes,
  OPENCODE_PLAN_MODE_ID,
  resolveOpencodeModeForPermissionMode,
  resolvePermissionModeForManagedOpencodeMode,
} from '../modes';
import { createOpencodeToolStreamAdapter } from '../normalization/opencodeToolNormalization';
import { getOpencodeProviderSettings, updateOpencodeProviderSettings } from '../settings';
import { getOpencodeState, type OpencodeProviderState } from '../types';
import { buildOpencodePromptBlocks, buildOpencodePromptText } from './buildOpencodePrompt';
import { buildActiveTurnEffect } from './opencodeActiveTurnUpdate';
import {
  buildAcpApprovalDecisionOptions,
  buildOpencodePermissionPresentation,
  mapApprovalDecision,
  normalizeApprovalInput,
} from './opencodeApprovalHelpers';
import { prepareOpencodeLaunchArtifacts, startOpencodeAcpProcess } from './OpencodeLaunchArtifacts';
import {
  type OpencodeModelStateProjection,
  projectOpencodeModelState,
} from './opencodeModelStateProjection';
import { buildOpencodeRuntimeEnv } from './OpencodeRuntimeEnvironment';
import { syncOpencodeSessionState } from './opencodeSessionStateSync';

interface ActiveTurn {
  queue: StreamChunkQueue;
  sessionId: string;
}

class StreamChunkQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.items.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }

  async next(): Promise<StreamChunk | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }

    if (this.closed) {
      return null;
    }

    return new Promise<StreamChunk | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export class OpencodeChatRuntime implements ChatRuntime {
  readonly providerId = 'opencode' as const;

  private activeTurn: ActiveTurn | null = null;
  private connection: AcpClientConnection | null = null;
  private contextUsage: AcpUsageUpdate | null = null;
  private currentDatabasePath: string | null = null;
  private currentLaunchKey: string | null = null;
  private currentSessionEffortConfigId: string | null = null;
  private currentSessionEffortValue: string | null = null;
  private currentSessionEffortValues = new Set<string>();
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;
  private currentTurnIsPlan = false;
  private currentTurnSawAssistantContent = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private loadedSessionId: string | null = null;
  private process: AcpSubprocess | null = null;
  private promptUsage: AcpUsage | null = null;
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private ready = false;
  private sessionInvalidated = false;
  private readonly supportedCommandWaiters: Array<(commands: SlashCommand[]) => void> = [];
  private supportedCommands: SlashCommand[] = [];
  private sessionCwds = new Map<string, string>();
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private readonly toolStreamAdapter = createOpencodeToolStreamAdapter();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  constructor(
    private readonly plugin: PluginContext,
    private readonly host: RuntimeHost,
  ) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return OPENCODE_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: buildOpencodePromptText(request),
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.push(listener);
    return () => {
      const index = this.readyListeners.indexOf(listener);
      if (index >= 0) {
        this.readyListeners.splice(index, 1);
      }
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(
    conversation: { providerState?: Record<string, unknown>; sessionId?: string | null } | null,
  ): void {
    const previousSessionId = this.sessionId;
    const nextSessionId = conversation?.sessionId ?? null;
    if (this.sessionId !== nextSessionId) {
      this.currentSessionEffortConfigId = null;
      this.currentSessionEffortValue = null;
      this.currentSessionEffortValues = new Set<string>();
      this.currentSessionModelId = null;
      this.currentSessionModeId = null;
      this.sessionInvalidated = false;
      this.setSupportedCommands([]);
    }
    this.sessionId = nextSessionId;
    const state = getOpencodeState(conversation?.providerState);
    if (state.databasePath) {
      this.currentDatabasePath = state.databasePath;
      return;
    }

    if (!nextSessionId || nextSessionId !== previousSessionId) {
      this.currentDatabasePath = null;
    }
  }

  async reloadMcpServers(): Promise<void> {}

  async warmModelMetadata(model: string): Promise<boolean> {
    const selectedRawModelId = decodeOpencodeModelId(model);
    if (!selectedRawModelId) {
      return false;
    }

    if (!(await this.ensureReady({ allowSessionCreation: true }))) {
      return false;
    }
    if (!this.connection || !this.sessionId) {
      return false;
    }

    const discoveredModels = getOpencodeProviderSettings(this.plugin.settings).discoveredModels;
    const selectedBaseRawModelId = resolveOpencodeBaseModelRawId(selectedRawModelId, discoveredModels);
    if (!selectedBaseRawModelId) {
      return false;
    }

    const availableModelIds = new Set(discoveredModels.map((entry) => entry.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(selectedBaseRawModelId)) {
      return false;
    }

    const response = await this.connection.setConfigOption({
      configId: 'model',
      sessionId: this.sessionId,
      type: 'select',
      value: selectedBaseRawModelId,
    });
    this.currentSessionModelId = selectedBaseRawModelId;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    });
    return true;
  }

  async ensureReady(
    options?: ChatRuntimeEnsureReadyOptions,
    grantedToolIds?: string[],
  ): Promise<boolean> {
    const settings = getOpencodeProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const targetSessionId = this.sessionId;
    const resolvedCliPath = this.plugin.getResolvedProviderCliPath('opencode') ?? 'opencode';
    const runtimeEnv = this.buildRuntimeEnv(
      resolvedCliPath,
      this.currentDatabasePath,
    );
    const promptSettings = this.getSystemPromptSettings(cwd);
    const artifacts = await this.prepareLaunchArtifacts(promptSettings, runtimeEnv, cwd, grantedToolIds);
    this.currentDatabasePath = artifacts.databasePath;

    const nextLaunchKey = JSON.stringify({
      command: resolvedCliPath,
      configPath: artifacts.configPath,
      envText: serializeEnvironmentVariables(this.plugin.getResolvedEnvironmentVariables('opencode')),
      promptKey: computeSystemPromptKey(promptSettings),
      artifactKey: artifacts.launchKey,
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || options?.force === true
      || this.currentLaunchKey !== nextLaunchKey;

    if (shouldRestart) {
      await this.shutdownProcess();
      await this.startProcess({
        command: resolvedCliPath,
        configPath: artifacts.configPath,
        cwd,
        runtimeEnv,
      });
      this.currentLaunchKey = nextLaunchKey;
      this.loadedSessionId = null;
    }

    if (targetSessionId) {
      if (this.loadedSessionId !== targetSessionId) {
        const loaded = await this.loadSession(targetSessionId, cwd);
        if (!loaded) {
          this.sessionInvalidated = true;
          this.clearActiveSession();
        }
      }
      return true;
    }

    if (!this.sessionId && !this.sessionInvalidated) {
      if (options?.allowSessionCreation === false) {
        return true;
      }
      return Boolean(await this.createSession(cwd));
    }

    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const previousMessages = conversationHistory ?? [];
    const expectedSessionId = this.sessionId;
    let shouldBootstrapHistory = previousMessages.length > 0
      && (!expectedSessionId || this.sessionInvalidated);

    // Thread the bound agent's grant into the managed `mcp.claudian` config so
    // it carries the scoped (per-grant) bearer token; an empty/absent grant
    // yields today's all-tools default. Phase-1 limitation: Opencode's process +
    // config are written once at spawn (ensureReady), not per-turn, so this
    // scopes whichever conversation triggers the (re)spawn. Re-scoping a
    // long-running process across conversations with *different* grants needs a
    // live runtime — a Phase 2 concern; we do not re-spawn/rewrite config here.
    if (!(await this.ensureReady(undefined, queryOptions?.boundAgentTools))) {
      yield { type: 'error', content: 'Failed to start OpenCode. Check the CLI path and login state.' };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: 'OpenCode runtime is not ready.' };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    if (expectedSessionId && !this.sessionId) {
      shouldBootstrapHistory = previousMessages.length > 0;
    }

    if (!this.sessionId) {
      const sessionId = await this.createSession(cwd);
      if (!sessionId) {
        yield { type: 'error', content: 'Failed to create an OpenCode session.' };
        yield { type: 'done' };
        return;
      }
    }

    const sessionId = this.sessionId!;
    this.activeTurn?.queue.close();
    this.activeTurn = {
      queue: new StreamChunkQueue(),
      sessionId,
    };
    this.currentTurnMetadata = {};
    this.currentTurnIsPlan = false;
    this.currentTurnSawAssistantContent = false;
    this.contextUsage = null;
    this.promptUsage = null;
    this.sessionUpdateNormalizer.reset();
    this.toolStreamAdapter.reset();

    const activeTurn = this.activeTurn;
    try {
      await this.applySelectedMode(sessionId);
      this.currentTurnIsPlan = this.currentSessionModeId === OPENCODE_PLAN_MODE_ID;
      await this.applySelectedModel(sessionId, queryOptions);
      await this.applySelectedEffort(sessionId);
    } catch (error) {
      yield {
        type: 'error',
        content: this.formatRuntimeError(error),
      };
      yield { type: 'done' };
      activeTurn.queue.close();
      this.activeTurn = null;
      return;
    }

    const promptPromise = this.connection.prompt({
      prompt: buildOpencodePromptBlocks(
        turn.request,
        shouldBootstrapHistory ? previousMessages : [],
        queryOptions?.boundAgentPrompt,
      ),
      sessionId,
    }).then((response) => {
      if (response.userMessageId) {
        this.currentTurnMetadata.userMessageId = response.userMessageId;
      }
      this.promptUsage = response.usage ?? null;

      const usage = buildAcpUsageInfo({
        contextWindow: this.contextUsage,
        // Fall back to the synthetic provider id when no concrete model is selected yet:
        // buildAcpUsageInfo requires a non-empty model string (see shared buildUsageInfo).
        model: this.getActiveDisplayModel(queryOptions) ?? OPENCODE_SYNTHETIC_MODEL_ID,
        promptUsage: this.promptUsage,
      });
      if (usage) {
        activeTurn.queue.push({ sessionId, type: 'usage', usage });
      }

      this.finalizePlanTurnMetadata();
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).catch((error) => {
      activeTurn.queue.push({
        type: 'error',
        content: this.formatRuntimeError(error),
      });
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).finally(() => {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    });

    try {
      while (true) {
        const chunk = await activeTurn.queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
      await promptPromise;
    } finally {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    if (this.connection && this.sessionId) {
      this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  resetSession(): void {
    this.clearActiveSession();
    this.sessionInvalidated = false;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    if (this.supportedCommands.length > 0 && this.loadedSessionId === this.sessionId) {
      return [...this.supportedCommands];
    }

    if (this.sessionId && this.loadedSessionId !== this.sessionId) {
      const ready = await this.ensureReady({ allowSessionCreation: false });
      if (!ready) {
        return [];
      }
    }

    if (!this.sessionId) {
      return [];
    }

    if (this.supportedCommands.length > 0) {
      return [...this.supportedCommands];
    }

    if (!this.sessionId || this.loadedSessionId !== this.sessionId) {
      return [];
    }

    return this.waitForSupportedCommands();
  }

  async cleanup(): Promise<void> {
    this.activeTurn?.queue.close();
    await this.shutdownProcess();
  }

  // rewind() omitted — Opencode does not support rewind
  // (supportsRewind: false). Callers gate on capability; ADR-0001 Phase 2.

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  private finalizePlanTurnMetadata(): void {
    if (this.currentTurnIsPlan && this.currentTurnSawAssistantContent) {
      this.currentTurnMetadata.planCompleted = true;
    }
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const existingState = params.conversation
      ? getOpencodeState(params.conversation.providerState)
      : null;
    const providerState: OpencodeProviderState = {
      ...(this.currentDatabasePath || existingState?.databasePath
        ? { databasePath: this.currentDatabasePath ?? existingState?.databasePath }
        : {}),
    };
    const updates: Partial<Conversation> = {
      providerState: Object.keys(providerState).length > 0
        ? providerState as Record<string, unknown>
        : undefined,
      sessionId: this.sessionId,
    };

    if (params.sessionInvalidated) {
      if (!this.sessionId) {
        updates.providerState = undefined;
        updates.sessionId = null;
      }
    }

    return { updates };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.sessionId ?? conversation?.sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private async startProcess(params: {
    command: string;
    configPath: string;
    cwd: string;
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    // params.runtimeEnv is already the allowlisted env from
    // buildOpencodeRuntimeEnv. Spreading process.env here would reintroduce
    // every host var (including denied keys like NODE_TLS_REJECT_UNAUTHORIZED),
    // defeating the allowlist contract.
    const processEnv: NodeJS.ProcessEnv = {
      ...params.runtimeEnv,
      OPENCODE_CONFIG: params.configPath,
      PATH: getEnhancedPath(
        params.runtimeEnv.PATH,
        path.isAbsolute(params.command) ? params.command : undefined,
      ),
    };

    const { process, transport } = startOpencodeAcpProcess({
      command: params.command,
      cwd: params.cwd,
      env: processEnv,
    });
    this.process = process;
    this.transport = transport;
    this.unregisterTransportClose = transport.onClose(() => {
      if (this.transport === transport) {
        this.setReady(false);
      }
    });

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: {
          readTextFile: (request) => this.readTextFile(request),
          writeTextFile: (request) => this.writeTextFile(request),
        },
        onSessionNotification: (notification) => this.handleSessionNotification(notification),
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
    this.setReady(true);
  }

  private async shutdownProcess(): Promise<void> {
    this.setReady(false);
    this.activeTurn?.queue.close();
    this.activeTurn = null;
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
    this.setSupportedCommands([]);

    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;

    this.connection?.dispose();
    this.connection = null;

    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown().catch(() => {}); // best-effort
      this.process = null;
    }
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }

    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }

  private getSystemPromptSettings(vaultPath: string): SystemPromptSettings {
    return {
      customPrompt: this.plugin.settings.systemPrompt,
      mediaFolder: this.plugin.settings.mediaFolder,
      userName: this.plugin.settings.userName,
      vaultPath,
    };
  }


  private buildRuntimeEnv(
    cliPath: string,
    databasePathOverride?: string | null,
  ): NodeJS.ProcessEnv {
    return buildOpencodeRuntimeEnv(
      this.plugin.getResolvedEnvironmentVariables('opencode'),
      cliPath,
      databasePathOverride,
    );
  }

  private getProviderSettings(): Record<string, unknown> {
    return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      this.providerId,
    );
  }

  private resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const providerSettings = this.getProviderSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (!isOpencodeModelSelectionId(selectedModel)) {
      return null;
    }

    const selectedBaseRawModelId = decodeOpencodeModelId(selectedModel);
    if (!selectedBaseRawModelId) {
      return null;
    }

    const discoveredModels = getOpencodeProviderSettings(providerSettings).discoveredModels;
    const normalizedBaseRawModelId = resolveOpencodeBaseModelRawId(selectedBaseRawModelId, discoveredModels);
    if (!normalizedBaseRawModelId) {
      return null;
    }

    const availableModelIds = new Set(discoveredModels.map((model) => model.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(normalizedBaseRawModelId)) {
      return null;
    }

    return normalizedBaseRawModelId;
  }

  getAuxiliaryModel(): string | null {
    return this.getActiveDisplayModel() ?? null;
  }

  private getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string | undefined {
    const providerSettings = this.getProviderSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (
      selectedModel
      && selectedModel !== OPENCODE_SYNTHETIC_MODEL_ID
      && isOpencodeModelSelectionId(selectedModel)
    ) {
      const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
      return selectedRawModelId
        ? encodeOpencodeModelId(selectedRawModelId)
        : selectedModel;
    }

    return this.currentSessionModelId
      ? encodeOpencodeModelId(this.currentSessionModelId)
      : (selectedModel && isOpencodeModelSelectionId(selectedModel) ? selectedModel : undefined);
  }

  private resolveSelectedModeId(): string | null {
    const providerSettings = this.getProviderSettings();
    const opencodeSettings = getOpencodeProviderSettings(providerSettings);
    const availableModes = getManagedOpencodeModes(opencodeSettings.availableModes);
    const mappedModeId = resolveOpencodeModeForPermissionMode(
      providerSettings.permissionMode,
      opencodeSettings.availableModes,
    );
    if (mappedModeId) {
      return mappedModeId;
    }

    if (opencodeSettings.selectedMode) {
      if (
        availableModes.some((mode) => mode.id === opencodeSettings.selectedMode)
      ) {
        return opencodeSettings.selectedMode;
      }
    }

    return availableModes[0]?.id || null;
  }

  private async applySelectedMode(sessionId: string): Promise<void> {
    if (!this.connection) {
      return;
    }

    const selectedModeId = this.resolveSelectedModeId();
    if (!selectedModeId || selectedModeId === this.currentSessionModeId) {
      return;
    }

    const response = await this.connection.setConfigOption({
      configId: 'mode',
      sessionId,
      type: 'select',
      value: selectedModeId,
    });
    this.currentSessionModeId = selectedModeId;
    await this.syncSessionModeState({
      configOptions: response.configOptions,
    });
  }

  private async applySelectedModel(
    sessionId: string,
    queryOptions?: ChatRuntimeQueryOptions,
  ): Promise<void> {
    if (!this.connection) {
      return;
    }

    const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
    if (!selectedRawModelId || selectedRawModelId === this.currentSessionModelId) {
      return;
    }

    const response = await this.connection.setConfigOption({
      configId: 'model',
      sessionId,
      type: 'select',
      value: selectedRawModelId,
    });
    this.currentSessionModelId = selectedRawModelId;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    });
  }

  private resolveSelectedEffortValue(): string | null {
    const providerSettings = this.getProviderSettings();
    const selectedEffort = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel.trim()
      : '';
    if (!selectedEffort || selectedEffort === OPENCODE_DEFAULT_THINKING_LEVEL) {
      return null;
    }

    return this.currentSessionEffortValues.has(selectedEffort)
      ? selectedEffort
      : null;
  }

  private async applySelectedEffort(sessionId: string): Promise<void> {
    if (!this.connection || !this.currentSessionEffortConfigId) {
      return;
    }

    const selectedEffort = this.resolveSelectedEffortValue();
    if (!selectedEffort || selectedEffort === this.currentSessionEffortValue) {
      return;
    }

    const response = await this.connection.setConfigOption({
      configId: this.currentSessionEffortConfigId,
      sessionId,
      type: 'select',
      value: selectedEffort,
    });
    this.currentSessionEffortValue = selectedEffort;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    });
  }

  private resolveSessionModelInfo(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    models?: AcpSessionModelState | null;
  }): { discoveredModels: OpencodeDiscoveredModel[]; currentBaseRawModelId: string | null } {
    const acpState = extractAcpSessionModelState(params);
    const currentRawModelId = acpState.currentModelId ?? this.currentSessionModelId;
    const discoveredModels = normalizeOpencodeDiscoveredModels(
      acpState.availableModels.map((model) => ({
        ...(model.description ? { description: model.description } : {}),
        label: model.name,
        rawId: model.id,
      })),
    );
    if (currentRawModelId) {
      this.currentSessionModelId = currentRawModelId;
    }

    return {
      discoveredModels,
      currentBaseRawModelId: currentRawModelId
        ? resolveOpencodeBaseModelRawId(currentRawModelId, discoveredModels)
        : null,
    };
  }

  private resolveSessionThinkingInfo(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    models?: AcpSessionModelState | null;
  }): { currentThinkingOptions: OpencodeModelVariant[]; currentThinkingLevel: string | null } {
    const thoughtLevelState = extractAcpSessionThoughtLevelState(params);
    const currentThinkingOptions = normalizeOpencodeModelVariants(
      thoughtLevelState.availableLevels.map((level) => ({
        ...(level.description ? { description: level.description } : {}),
        label: level.name,
        value: level.id,
      })),
    );
    const currentThinkingLevel = thoughtLevelState.currentLevel;
    this.currentSessionEffortConfigId = currentThinkingOptions.length > 0
      ? thoughtLevelState.configId
      : null;
    this.currentSessionEffortValue = currentThinkingOptions.length > 0
      ? currentThinkingLevel
      : null;
    this.currentSessionEffortValues = new Set(currentThinkingOptions.map((option) => option.value));

    return { currentThinkingOptions, currentThinkingLevel };
  }

  private async syncSessionModelState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    models?: AcpSessionModelState | null;
  }): Promise<void> {
    const settingsBag = asSettingsBag(this.plugin.settings);
    const currentSettings = getOpencodeProviderSettings(settingsBag);
    const { discoveredModels, currentBaseRawModelId } = this.resolveSessionModelInfo(params);
    const { currentThinkingOptions, currentThinkingLevel } = this.resolveSessionThinkingInfo(params);

    const projection = projectOpencodeModelState({
      currentSettings,
      currentBaseRawModelId,
      currentThinkingLevel,
      currentThinkingOptions,
      currentThinkingOptionValues: this.currentSessionEffortValues,
      discoveredModels,
    });

    const discoveryChanged = projection.shouldUpdateDiscoveredModels
      && updateOpencodeDiscoveryState(settingsBag, { discoveredModels });
    const changed = this.applyModelStateProjection(settingsBag, projection, {
      currentBaseRawModelId,
      currentThinkingLevel,
    });

    if (!changed && !discoveryChanged && !projection.shouldUpdateThinkingOptions) {
      return;
    }

    if (changed || projection.shouldUpdateThinkingOptions) {
      await this.plugin.saveSettings();
    }
    this.refreshModelSelectors();
  }

  private applyModelStateProjection(
    settingsBag: Record<string, unknown>,
    projection: OpencodeModelStateProjection,
    active: { currentBaseRawModelId: string | null; currentThinkingLevel: string | null },
  ): boolean {
    let changed = projection.shouldSeedVisibleModels || projection.shouldSeedPreferredThinking;

    if (active.currentBaseRawModelId) {
      const seeded = this.seedActiveModelSelection(
        settingsBag,
        encodeOpencodeModelId(active.currentBaseRawModelId),
        active.currentThinkingLevel,
      );
      changed = changed || seeded;
    }

    if (projection.shouldUpdateThinkingOptions
      || projection.shouldSeedPreferredThinking
      || projection.shouldSeedVisibleModels) {
      updateOpencodeProviderSettings(settingsBag, {
        ...(projection.shouldSeedPreferredThinking
          ? { preferredThinkingByModel: projection.nextPreferredThinkingByModel }
          : {}),
        ...(projection.shouldUpdateThinkingOptions
          ? { thinkingOptionsByModel: projection.nextThinkingOptionsByModel }
          : {}),
        ...(projection.shouldSeedVisibleModels ? { visibleModels: projection.nextVisibleModels } : {}),
      });
    }

    return changed;
  }

  private seedActiveModelSelection(
    settingsBag: Record<string, unknown>,
    modelSelection: string,
    thinkingLevel: string | null,
  ): boolean {
    let changed = false;
    const savedProviderModel = ensureProviderProjectionMap(settingsBag, 'savedProviderModel');
    const savedModel = typeof savedProviderModel.opencode === 'string'
      ? savedProviderModel.opencode
      : '';
    if (!savedModel || savedModel === OPENCODE_SYNTHETIC_MODEL_ID) {
      savedProviderModel.opencode = modelSelection;
      changed = true;
    }

    if (thinkingLevel) {
      const savedProviderEffort = ensureProviderProjectionMap(settingsBag, 'savedProviderEffort');
      const savedEffort = typeof savedProviderEffort.opencode === 'string'
        ? savedProviderEffort.opencode.trim()
        : '';
      if (!savedEffort || savedEffort === OPENCODE_DEFAULT_THINKING_LEVEL) {
        savedProviderEffort.opencode = thinkingLevel;
        changed = true;
      }
    }

    if (ProviderRegistry.resolveSettingsProviderId(settingsBag) !== this.providerId) {
      return changed;
    }

    const activeModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
    if (!activeModel || activeModel === OPENCODE_SYNTHETIC_MODEL_ID) {
      settingsBag.model = modelSelection;
      changed = true;
    }
    if (thinkingLevel) {
      const activeEffort = typeof settingsBag.effortLevel === 'string' ? settingsBag.effortLevel : '';
      if (!activeEffort || activeEffort === OPENCODE_DEFAULT_THINKING_LEVEL) {
        settingsBag.effortLevel = thinkingLevel;
        changed = true;
      }
    }
    return changed;
  }

  private async syncSessionModeState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    currentModeId?: string | null;
    modes?: AcpSessionModeState | null;
  }): Promise<void> {
    const acpState = extractAcpSessionModeState(params);
    const availableModes = normalizeOpencodeAvailableModes(acpState.availableModes);
    const currentModeId = params.currentModeId ?? acpState.currentModeId;
    if (currentModeId) {
      this.currentSessionModeId = currentModeId;
      this.emitPermissionModeSync(currentModeId);
    }

    const settingsBag = asSettingsBag(this.plugin.settings);
    const currentSettings = getOpencodeProviderSettings(settingsBag);
    const shouldSeedSelectedMode = typeof currentModeId === 'string'
      && !currentSettings.selectedMode
      && isManagedOpencodeModeId(currentModeId);
    const discoveryChanged = availableModes.length > 0
      && !sameModes(currentSettings.availableModes, availableModes)
      && updateOpencodeDiscoveryState(settingsBag, { availableModes });

    if (!discoveryChanged && !shouldSeedSelectedMode) {
      return;
    }

    if (shouldSeedSelectedMode && currentModeId) {
      updateOpencodeProviderSettings(settingsBag, { selectedMode: currentModeId });
      await this.plugin.saveSettings();
    }
    this.refreshModelSelectors();
  }

  private refreshModelSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
  }

  private emitPermissionModeSync(modeId: string): void {
    const permissionMode = resolvePermissionModeForManagedOpencodeMode(modeId);
    if (!permissionMode) {
      return;
    }

    try {
      this.host.permissionModeSync(permissionMode);
    } catch {
      // Non-critical UI sync callback.
    }
  }

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      this.setSupportedCommands([]);
      const response = await this.connection.newSession({
        cwd,
        mcpServers: [],
      });
      this.loadedSessionId = response.sessionId;
      this.sessionId = response.sessionId;
      this.sessionCwds.set(response.sessionId, cwd);
      await syncOpencodeSessionState(
        response,
        params => this.syncSessionModelState(params),
        params => this.syncSessionModeState(params),
      );
      return response.sessionId;
    } catch {
      return null;
    }
  }

  private async loadSession(sessionId: string, cwd: string): Promise<boolean> {
    if (!this.connection) {
      return false;
    }

    try {
      this.setSupportedCommands([]);
      const response = await this.connection.loadSession({
        cwd,
        mcpServers: [],
        sessionId,
      });
      this.sessionInvalidated = false;
      this.loadedSessionId = response.sessionId;
      this.sessionId = response.sessionId;
      this.sessionCwds.set(response.sessionId, cwd);
      await syncOpencodeSessionState(
        response,
        params => this.syncSessionModelState(params),
        params => this.syncSessionModeState(params),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async handleSessionNotification(
    notification: AcpSessionNotification,
  ): Promise<void> {
    if (notification.sessionId !== this.sessionId) {
      return;
    }

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
    if (await this.applySessionConfigUpdate(normalized)) {
      return;
    }

    if (!this.activeTurn || this.activeTurn.sessionId !== notification.sessionId) {
      return;
    }

    if (
      normalized.type === 'message_chunk'
      || normalized.type === 'tool_call'
      || normalized.type === 'tool_call_update'
      || normalized.type === 'usage'
    ) {
      this.applyActiveTurnUpdate(this.activeTurn, normalized, notification.sessionId);
    }
  }

  // Session-scoped (non-turn) updates that adjust model/mode/command state.
  // Returns true when the update was fully handled here.
  private async applySessionConfigUpdate(normalized: AcpNormalizedUpdate): Promise<boolean> {
    if (normalized.type === 'config_options') {
      await this.syncSessionModelState({ configOptions: normalized.configOptions });
      await this.syncSessionModeState({ configOptions: normalized.configOptions });
      return true;
    }

    if (normalized.type === 'current_mode') {
      await this.syncSessionModeState({ currentModeId: normalized.currentModeId });
      return true;
    }

    if (normalized.type === 'commands') {
      this.setSupportedCommands(normalized.commands);
      return true;
    }

    return false;
  }

  private applyActiveTurnUpdate(
    activeTurn: ActiveTurn,
    normalized: Parameters<typeof buildActiveTurnEffect>[0],
    sessionId: string,
  ): void {
    const effect = buildActiveTurnEffect(normalized, {
      promptUsage: this.promptUsage,
      // Fall back to the synthetic provider id when no concrete model is selected yet:
      // buildAcpUsageInfo requires a non-empty model string (see shared buildUsageInfo).
      // Resolved lazily so non-usage updates never trigger model resolution.
      resolveUsageModel: () => this.getActiveDisplayModel() ?? OPENCODE_SYNTHETIC_MODEL_ID,
      sessionId,
      toolStreamAdapter: this.toolStreamAdapter,
    });

    if (effect.metadataPatch) {
      Object.assign(this.currentTurnMetadata, effect.metadataPatch);
    }
    if (effect.sawAssistantContent) {
      this.currentTurnSawAssistantContent = true;
    }
    if (effect.contextUsage !== undefined) {
      this.contextUsage = effect.contextUsage;
    }
    for (const chunk of effect.chunks) {
      activeTurn.queue.push(chunk);
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    const input = normalizeApprovalInput(request.toolCall.rawInput);
    const presentation = buildOpencodePermissionPresentation(request.toolCall.title, input, request.toolCall.locations);
    const decision = await this.host.approval(
      presentation.toolName,
      input,
      presentation.description,
      {
        ...(presentation.blockedPath ? { blockedPath: presentation.blockedPath } : {}),
        ...(presentation.decisionReason ? { decisionReason: presentation.decisionReason } : {}),
        decisionOptions: buildAcpApprovalDecisionOptions(request.options),
      },
    );

    return mapApprovalDecision(decision, request.options);
  }

  private setSupportedCommands(commands: SlashCommand[]): void {
    this.supportedCommands = commands.map((command) => ({ ...command }));

    const waiters = this.supportedCommandWaiters.splice(0);
    for (const waiter of waiters) {
      waiter(this.supportedCommands);
    }
  }

  private waitForSupportedCommands(timeoutMs = 250): Promise<SlashCommand[]> {
    if (this.supportedCommands.length > 0) {
      return Promise.resolve([...this.supportedCommands]);
    }

    return new Promise<SlashCommand[]>((resolve) => {
      const waiter = (commands: SlashCommand[]) => {
        window.clearTimeout(timeoutId);
        resolve([...commands]);
      };
      const timeoutId = window.setTimeout(() => {
        const index = this.supportedCommandWaiters.indexOf(waiter);
        if (index >= 0) {
          this.supportedCommandWaiters.splice(index, 1);
        }
        resolve([...this.supportedCommands]);
      }, timeoutMs);

      this.supportedCommandWaiters.push(waiter);
    });
  }

  private async readTextFile(
    request: AcpReadTextFileRequest,
  ): Promise<{ content: string }> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    return readWorkspaceTextFile(resolvedPath, request);
  }

  private async writeTextFile(
    request: AcpWriteTextFileRequest,
  ): Promise<Record<string, never>> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, request.content, 'utf-8');
    return {};
  }

  private resolveSessionPath(sessionId: string, rawPath: string): string {
    const cwd = this.sessionCwds.get(sessionId)
      ?? getVaultPath(this.plugin.app)
      ?? process.cwd();
    return resolveWorkspaceScopedPath(
      cwd,
      rawPath,
      'OpenCode file access is limited to the current workspace.',
    );
  }

  private formatRuntimeError(error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : 'OpenCode request failed';
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }

  private prepareLaunchArtifacts(
    settings: SystemPromptSettings,
    runtimeEnv: NodeJS.ProcessEnv,
    cwd: string,
    grantedToolIds?: string[],
  ): ReturnType<typeof prepareOpencodeLaunchArtifacts> {
    return prepareOpencodeLaunchArtifacts({
      // Scoped to the bound agent's grant when present; empty/absent → all-tools.
      httpToolServerConfig: this.plugin.getHttpToolServerConfig?.(grantedToolIds) ?? null,
      runtimeEnv,
      settings,
      workspaceRoot: cwd,
    });
  }

  private clearActiveSession(): void {
    this.currentDatabasePath = null;
    this.sessionId = null;
    this.loadedSessionId = null;
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
    this.setSupportedCommands([]);
  }
}
