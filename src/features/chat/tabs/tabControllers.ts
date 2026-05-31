import type { Component } from 'obsidian';
import { Notice } from 'obsidian';

import { getEnabledProviderForModel } from '../../../core/providers/modelRouting';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type { AutoTurnResult } from '../../../core/runtime/types';
import { TOOL_AGENT_OUTPUT } from '../../../core/tools/toolNames';
import type { ChatMessage, StreamChunk } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import { ConversationController } from '../controllers/ConversationController';
import { InputController } from '../controllers/InputController';
import { NavigationController } from '../controllers/NavigationController';
import { SelectionController } from '../controllers/SelectionController';
import { StreamController } from '../controllers/StreamController';
import { MessageRenderer } from '../rendering/MessageRenderer';
import { findRewindContext } from '../rewind';
import { autoResizeTextarea } from '../ui/textareaResize';
import { getTabProviderId } from './providerResolution';
import { initializeTabService } from './tabLifecycle';
import {
  applyProviderUIGating,
  cleanupTabRuntime,
  generateMessageId,
  getTabCapabilities,
  getTabPermissionMode,
  type ProviderCatalogInfo,
  refreshTabProviderUI,
  resolveBlankTabModel,
  syncSlashCommandDropdownForProvider,
  syncTabProviderServices,
  updatePlanModeUI,
} from './tabShared';
import type { TabData } from './types';

export interface ForkContext {
  messages: ChatMessage[];
  providerId?: ProviderId;
  sourceSessionId: string;
  sourceProviderState?: Record<string, unknown>;
  resumeAt: string;
  sourceTitle?: string;
  /** 1-based index used for fork title suffix (counts only non-interrupt user messages). */
  forkAtUserMessage?: number;
  currentNote?: string;
}

function deepCloneMessages(messages: ChatMessage[]): ChatMessage[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(messages);
  }
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

function countUserMessagesForForkTitle(messages: ChatMessage[]): number {
  // Keep fork numbering stable by excluding non-semantic user messages.
  return messages.filter(m => m.role === 'user' && !m.isInterrupt && !m.isRebuiltContext).length;
}

interface ForkSource {
  providerId?: ProviderId;
  sourceSessionId: string;
  sourceProviderState?: Record<string, unknown>;
  sourceTitle?: string;
  currentNote?: string;
}

/**
 * Resolves session ID and conversation metadata needed for forking.
 * Prefers the live service session ID; falls back to persisted conversation metadata.
 * Shows a notice and returns null when no session can be resolved.
 */
function resolveForkSource(tab: TabData, plugin: ClaudianPlugin): ForkSource | null {
  const conversation = tab.conversationId
    ? plugin.getConversationSync(tab.conversationId)
    : null;

  // Delegate session ID resolution to the runtime when available;
  // fall back to persisted conversation metadata when no runtime is active.
  const sourceSessionId = tab.service
    ? tab.service.resolveSessionIdForFork(conversation ?? null)
    : ProviderRegistry
      .getConversationHistoryService(conversation?.providerId ?? tab.providerId)
      .resolveSessionIdForConversation(conversation);

  if (!sourceSessionId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoSession') }));
    return null;
  }

  return {
    providerId: getTabProviderId(tab, plugin, conversation),
    sourceSessionId,
    sourceProviderState: conversation?.providerState,
    sourceTitle: conversation?.title,
    currentNote: conversation?.currentNote,
  };
}

async function handleForkRequest(
  tab: TabData,
  plugin: ClaudianPlugin,
  userMessageId: string,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab, plugin).supportsFork) {
    new Notice('Fork is not supported by this provider.');
    return;
  }

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  const userIdx = msgs.findIndex(m => m.id === userMessageId);
  if (userIdx === -1) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorMessageNotFound') }));
    return;
  }

  if (!msgs[userIdx].userMessageId) {
    new Notice(t('chat.fork.unavailableNoUuid'));
    return;
  }

  const rewindCtx = findRewindContext(msgs, userIdx);
  if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
    new Notice(t('chat.fork.unavailableNoResponse'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs.slice(0, userIdx)),
    providerId: source.providerId,
    sourceSessionId: source.sourceSessionId,
    sourceProviderState: source.sourceProviderState,
    resumeAt: rewindCtx.prevAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs.slice(0, userIdx + 1)),
    currentNote: source.currentNote,
  });
}

async function handleForkAll(
  tab: TabData,
  plugin: ClaudianPlugin,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab, plugin).supportsFork) {
    new Notice('Fork is not supported by this provider.');
    return;
  }

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  if (msgs.length === 0) {
    new Notice(t('chat.fork.commandNoMessages'));
    return;
  }

  let lastAssistantUuid: string | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].assistantMessageId) {
      lastAssistantUuid = msgs[i].assistantMessageId;
      break;
    }
  }

  if (!lastAssistantUuid) {
    new Notice(t('chat.fork.commandNoAssistantUuid'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs),
    providerId: source.providerId,
    sourceSessionId: source.sourceSessionId,
    sourceProviderState: source.sourceProviderState,
    resumeAt: lastAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs) + 1,
    currentNote: source.currentNote,
  });
}

export function initializeTabControllers(
  tab: TabData,
  plugin: ClaudianPlugin,
  component: Component,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
): void;
/** @deprecated Legacy 7-arg overload — 4th arg was previously an MCP manager. */
export function initializeTabControllers(
  tab: TabData,
  plugin: ClaudianPlugin,
  component: Component,
  _legacyArg: unknown,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
): void;
export function initializeTabControllers(
  tab: TabData,
  plugin: ClaudianPlugin,
  component: Component,
  arg4?: unknown,
  arg5?: unknown,
  arg6?: unknown,
  arg7?: unknown,
): void {
  // Support legacy 7-arg call sites (4th arg was previously an MCP manager)
  const isLegacy = arg4 !== undefined && typeof arg4 !== 'function';
  const forkRequestCallback = (isLegacy ? arg5 : arg4) as
    ((forkContext: ForkContext) => Promise<void>) | undefined;
  const openConversation = (isLegacy ? arg6 : arg5) as
    ((conversationId: string) => Promise<void>) | undefined;
  const getProviderCatalogConfig = (isLegacy ? arg7 : arg6) as
    (() => ProviderCatalogInfo) | undefined;

  const { dom, state, services, ui } = tab;

  // Create renderer
  tab.renderer = new MessageRenderer(
    plugin,
    component,
    dom.messagesEl,
    (id, mode) => tab.controllers.conversationController!.rewind(id, mode),
    forkRequestCallback
      ? (id) => handleForkRequest(tab, plugin, id, forkRequestCallback)
      : undefined,
    () => getTabCapabilities(tab, plugin),
  );

  // Selection controller
  tab.controllers.selectionController = new SelectionController(
    plugin.app,
    dom.selectionIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl),
    dom.contentEl,
  );

  tab.controllers.browserSelectionController = new BrowserSelectionController(
    plugin.app,
    dom.browserIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl)
  );

  tab.controllers.canvasSelectionController = new CanvasSelectionController(
    plugin.app,
    dom.canvasIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl)
  );

  tab.controllers.streamController = new StreamController({
    plugin,
    state,
    renderer: tab.renderer,
    subagentManager: services.subagentManager,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    updateQueueIndicator: () => tab.controllers.inputController?.updateQueueIndicator(),
    getAgentService: () => tab.service,
  });

  // Wire subagent callback now that StreamController exists
  // DOM updates for async subagents are handled by SubagentManager directly;
  // this callback handles message persistence.
  services.subagentManager.setCallback(
    (subagent) => {
      tab.controllers.streamController?.onAsyncSubagentStateChange(subagent);

      // During active stream, regular end-of-turn save captures latest state.
      if (!tab.state.isStreaming && tab.state.currentConversationId) {
        void tab.controllers.conversationController?.save(false).catch(() => {
          // Best-effort persistence; avoid surfacing background-save failures here.
        });
      }
    }
  );

  tab.controllers.conversationController = new ConversationController(
    {
      plugin,
      state,
      renderer: tab.renderer,
      subagentManager: services.subagentManager,
      getHistoryDropdown: () => null, // Tab doesn't have its own history dropdown
      getWelcomeEl: () => dom.welcomeEl,
      setWelcomeEl: (el) => { dom.welcomeEl = el; },
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.inputEl,
      getFileContextManager: () => ui.fileContextManager,
      getImageContextManager: () => ui.imageContextManager,
      getMcpServerSelector: () => ui.mcpServerSelector,
      getExternalContextSelector: () => ui.externalContextSelector,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
      getTitleGenerationService: () => services.titleGenerationService,
      getStatusPanel: () => ui.statusPanel,
      getAgentService: () => tab.service, // Use tab's service instead of plugin's
      dismissPendingInlinePrompts: () => tab.controllers.inputController?.dismissPendingApproval(),
      ensureServiceForConversation: async (conversation) => {
        const nextProviderId = getTabProviderId(tab, plugin, conversation);
        const providerChanged = tab.providerId !== nextProviderId;
        tab.providerId = nextProviderId;

        if (providerChanged) {
          syncTabProviderServices(tab, plugin);
        }

        // Bind session state only — runtime starts on send
        tab.conversationId = conversation?.id ?? null;
        tab.draftModel = null;
        tab.lifecycleState = conversation ? 'bound_cold' : 'blank';
        syncSlashCommandDropdownForProvider(tab, plugin, getProviderCatalogConfig, conversation);

        // If the runtime already exists for the right provider, sync it passively
        if (tab.service && tab.service.providerId === nextProviderId && conversation) {
          const hasMessages = conversation.messages.length > 0;
          const externalContextPaths = hasMessages
            ? conversation.externalContextPaths || []
            : (plugin.settings.persistentExternalContextPaths || []);
          tab.service.syncConversationState(conversation, externalContextPaths);
        }

        refreshTabProviderUI(tab, plugin);
        applyProviderUIGating(tab, plugin);
      },
    },
    {
      onNewConversation: () => {
        // Reset to blank state and drop the bound runtime so the next send
        // reinitializes against the currently selected blank-tab provider.
        // cleanupTabRuntime detaches the service synchronously, then awaits the
        // outgoing CLI process exit; the framework callback can't be async, so
        // run the teardown in a contained async IIFE so the old process is gone
        // before the next send constructs a replacement.
        const previousProviderId = tab.providerId;
        cleanupTabRuntime(tab).catch((error) =>
          plugin.logger.scope('chat').error('tab runtime cleanup failed', error),
        );
        tab.lifecycleState = 'blank';
        tab.draftModel = resolveBlankTabModel(plugin, previousProviderId);
        tab.conversationId = null;
        tab.providerId = getTabProviderId(tab, plugin);
        if (tab.providerId !== previousProviderId) {
          syncTabProviderServices(tab, plugin);
        }
        refreshTabProviderUI(tab, plugin);
        applyProviderUIGating(tab, plugin);
        syncSlashCommandDropdownForProvider(tab, plugin, getProviderCatalogConfig);
      },
      onConversationLoaded: () => ui.slashCommandDropdown?.resetSdkSkillsCache(),
      onConversationSwitched: () => ui.slashCommandDropdown?.resetSdkSkillsCache(),
    }
  );

  tab.controllers.inputController = new InputController({
    plugin,
    state,
    renderer: tab.renderer,
    streamController: tab.controllers.streamController,
    selectionController: tab.controllers.selectionController,
    browserSelectionController: tab.controllers.browserSelectionController,
    canvasSelectionController: tab.controllers.canvasSelectionController,
    conversationController: tab.controllers.conversationController,
    getInputEl: () => dom.inputEl,
    getInputContainerEl: () => dom.inputContainerEl,
    getWelcomeEl: () => dom.welcomeEl,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    getImageContextManager: () => ui.imageContextManager,
    getMcpServerSelector: () => ui.mcpServerSelector,
    getExternalContextSelector: () => ui.externalContextSelector,
    getInstructionModeManager: () => ui.instructionModeManager,
    getInstructionRefineService: () => services.instructionRefineService,
    getTitleGenerationService: () => services.titleGenerationService,
    getStatusPanel: () => ui.statusPanel,
    generateId: generateMessageId,
    resetInputHeight: () => {
      // Per-tab input height is managed by CSS, no dynamic adjustment needed
    },
    getAuxiliaryModel: () => tab.service?.getAuxiliaryModel?.() ?? tab.draftModel ?? null,
    getAgentService: () => tab.service,
    getSubagentManager: () => services.subagentManager,
    getTabProviderId: () => getTabProviderId(tab, plugin),
    ensureServiceInitialized: async () => {
      if (tab.serviceInitialized && tab.lifecycleState === 'bound_active') {
        return true;
      }

      try {
        // For blank tabs on first send: derive provider from draft model
        if (tab.lifecycleState === 'blank' && tab.draftModel) {
          const derivedProvider = getEnabledProviderForModel(
            tab.draftModel,
            plugin.settings,
          );
          tab.providerId = derivedProvider;
        }

        await initializeTabService(tab, plugin);
        setupServiceCallbacks(tab, plugin);

        // Transition: lock model selector to bound provider
        refreshTabProviderUI(tab, plugin);
        applyProviderUIGating(tab, plugin);
        return true;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : 'Failed to initialize chat service');
        return false;
      }
    },
    openConversation,
    onForkAll: forkRequestCallback
      ? () => handleForkAll(tab, plugin, forkRequestCallback)
      : undefined,
    restorePrePlanPermissionModeIfNeeded: () => {
      if (getTabPermissionMode(tab, plugin) === 'plan') {
        const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
        tab.state.prePlanPermissionMode = null;
        updatePlanModeUI(tab, plugin, restoreMode);
      }
    },
  });

  tab.controllers.navigationController = new NavigationController({
    getMessagesEl: () => dom.messagesEl,
    getInputEl: () => dom.inputEl,
    getSettings: () => plugin.settings.keyboardNavigation,
    isStreaming: () => state.isStreaming,
    shouldSkipEscapeHandling: () => {
      if (ui.instructionModeManager?.isActive()) return true;
      if (ui.bangBashModeManager?.isActive()) return true;
      if (tab.controllers.inputController?.isResumeDropdownVisible()) return true;
      if (ui.slashCommandDropdown?.isVisible()) return true;
      if (ui.fileContextManager?.isMentionDropdownVisible()) return true;
      return false;
    },
  });
  tab.controllers.navigationController.initialize();
}

/** Shared between Tab.ts and TabManager.ts to avoid duplication. */
export function setupServiceCallbacks(tab: TabData, plugin: ClaudianPlugin): void {
  if (tab.service && tab.controllers.inputController) {
    tab.service.setApprovalCallback(
      async (toolName, input, description, options) =>
        await tab.controllers.inputController?.handleApprovalRequest(toolName, input, description, options)
        ?? 'cancel'
    );
    tab.service.setApprovalDismisser(
      () => tab.controllers.inputController?.dismissPendingApprovalPrompt()
    );
    tab.service.setAskUserQuestionCallback(
      async (input, signal) =>
        await tab.controllers.inputController?.handleAskUserQuestion(input, signal)
        ?? null
    );
    tab.service.setExitPlanModeCallback(
      async (input, signal) => {
        const decision = await tab.controllers.inputController?.handleExitPlanMode(input, signal) ?? null;
        // Revert only on approve; feedback and cancel keep plan mode active.
        if (decision !== null && decision.type !== 'feedback') {
          // Only restore permission mode if still in plan mode — user may have toggled out via Shift+Tab
          if (getTabPermissionMode(tab, plugin) === 'plan') {
            const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
            tab.state.prePlanPermissionMode = null;
            updatePlanModeUI(tab, plugin, restoreMode);
          }
          if (decision.type === 'approve-new-session') {
            tab.state.pendingNewSessionPlan = decision.planContent;
            tab.state.cancelRequested = true;
          }
        }
        return decision;
      }
    );
    tab.service.setSubagentHookProvider(
      () => ({
        hasRunning: tab.services.subagentManager.hasRunningSubagents(),
      })
    );
    tab.service.setAutoTurnCallback((result: AutoTurnResult) => renderAutoTriggeredTurn(tab, result));
    tab.service.setPermissionModeSyncCallback((sdkMode) => {
      const mode = sdkMode === 'bypassPermissions' || sdkMode === 'yolo'
        ? 'yolo'
        : sdkMode === 'plan'
        ? 'plan'
        : 'normal';
      const currentMode = getTabPermissionMode(tab, plugin);

      if (currentMode !== mode) {
        // Save pre-plan mode when entering plan (for Shift+Tab toggle restore)
        if (mode === 'plan' && tab.state.prePlanPermissionMode === null) {
          tab.state.prePlanPermissionMode = currentMode;
        }
        updatePlanModeUI(tab, plugin, mode);
      }
    });
  }
}

/**
 * Renders an auto-triggered turn (e.g., agent response to task-notification)
 * that arrives after the main handler has completed.
 */
function isVisibleAutoTurnChunk(chunk: StreamChunk, hiddenToolIds: Set<string>): boolean {
  switch (chunk.type) {
    case 'text':
      return chunk.content.trim().length > 0;
    case 'thinking':
    case 'notice':
    case 'error':
    case 'tool_output':
    case 'context_compacted':
    case 'subagent_tool_use':
    case 'subagent_tool_result':
      return true;
    case 'tool_use':
      return chunk.name !== TOOL_AGENT_OUTPUT;
    case 'tool_result':
      return !hiddenToolIds.has(chunk.id);
    default:
      return false;
  }
}

function hasVisibleAutoTurnMessageContent(msg: ChatMessage): boolean {
  if (msg.content.trim().length > 0) return true;
  if (msg.toolCalls && msg.toolCalls.length > 0) return true;
  return msg.contentBlocks?.some(block =>
    block.type !== 'text' || block.content.trim().length > 0
  ) ?? false;
}

async function renderAutoTriggeredTurn(tab: TabData, result: AutoTurnResult): Promise<void> {
  if (!tab.dom.contentEl.isConnected) {
    return;
  }

  const { chunks, metadata } = result;
  if (chunks.length === 0) return;

  const hiddenToolIds = new Set(
    chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use' }> =>
        chunk.type === 'tool_use' && chunk.name === TOOL_AGENT_OUTPUT
      )
      .map(chunk => chunk.id)
  );
  const hasVisibleContent = chunks.some(chunk => isVisibleAutoTurnChunk(chunk, hiddenToolIds));

  const assistantMsg: ChatMessage = {
    id: metadata.assistantMessageId ?? generateMessageId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
    ...(metadata.assistantMessageId && { assistantMessageId: metadata.assistantMessageId }),
  };

  const previousContentEl = tab.state.currentContentEl;
  const previousTextEl = tab.state.currentTextEl;
  const previousTextContent = tab.state.currentTextContent;
  const previousThinkingState = tab.state.currentThinkingState;

  if (hasVisibleContent) {
    tab.state.addMessage(assistantMsg);
    const msgEl = tab.renderer?.addMessage?.(assistantMsg);
    const contentEl = msgEl?.querySelector<HTMLElement>('.claudian-message-content');
    if (contentEl) {
      if (!previousContentEl) {
        tab.state.toolCallElements.clear();
      }
      tab.state.currentContentEl = contentEl;
      tab.state.currentTextEl = null;
      tab.state.currentTextContent = '';
      tab.state.currentThinkingState = null;
    }
  }

  try {
    for (const chunk of chunks) {
      await tab.controllers.streamController?.handleStreamChunk(chunk, assistantMsg);
    }

    if (hasVisibleContent && !hasVisibleAutoTurnMessageContent(assistantMsg)) {
      const placeholder = '(background task completed)';
      assistantMsg.content = placeholder;
      await tab.controllers.streamController?.appendText(placeholder);
    }

    if (hasVisibleContent) {
      await tab.controllers.streamController?.finalizeCurrentThinkingBlock(assistantMsg);
      await tab.controllers.streamController?.finalizeCurrentTextBlock(assistantMsg);
    }
  } finally {
    if (hasVisibleContent) {
      tab.controllers.streamController?.hideThinkingIndicator();
      tab.services.subagentManager.resetStreamingState?.();
      tab.state.currentContentEl = previousContentEl;
      tab.state.currentTextEl = previousTextEl;
      tab.state.currentTextContent = previousTextContent;
      tab.state.currentThinkingState = previousThinkingState;
      tab.renderer?.scrollToBottom();
    }
  }
}
