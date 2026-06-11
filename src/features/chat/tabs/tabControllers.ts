import type { Component } from 'obsidian';
import { Notice } from 'obsidian';

import { getEnabledProviderForModel } from '../../../core/providers/modelRouting';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type { ChatMessage } from '../../../core/types';
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
    new Notice(t('chat.fork.unsupportedProvider'));
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
    new Notice(t('chat.fork.unsupportedProvider'));
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

/**
 * Structural view of the host (`ClaudianView`) that owns pending hydration
 * failures. Declared locally to avoid importing the view type (circular import).
 */
interface PendingHydrationErrorHost {
  consumePendingHydrationError(conversationId: string): { code: string; message: string } | null;
}

export function initializeTabControllers(
  tab: TabData,
  plugin: ClaudianPlugin,
  component: Component,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
): void {
  const { dom, state, services, ui } = tab;

  // Create renderer
  tab.renderer = new MessageRenderer(plugin, component, dom.messagesEl, {
    rewindCallback: (id, mode) => tab.controllers.conversationController!.rewind(id, mode),
    forkCallback: forkRequestCallback
      ? (id) => handleForkRequest(tab, plugin, id, forkRequestCallback)
      : undefined,
    getCapabilities: () => getTabCapabilities(tab, plugin),
    getWorkOrderPath: () =>
      tab.workOrderPath
      ?? (tab.conversationId
        ? plugin.getConversationSync(tab.conversationId)?.workOrderPath ?? null
        : null),
  });

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
    onRetryLastTurn: () => tab.controllers.inputController?.retryLastTurn(),
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
      consumePendingHydrationError: (conversationId: string) =>
        (component as Partial<PendingHydrationErrorHost>)
          .consumePendingHydrationError?.(conversationId) ?? null,
      getWorkOrderPath: () => tab.workOrderPath ?? null,
      ensureServiceForConversation: async (conversation) => {
        // Clear transient tab work-order path when (re)binding a conversation:
        // a task-run tab that later opens an unrelated conversation in place
        // must not keep treating it as a work-order chat, and must not let the
        // save accessor write a stale path onto the wrong conversation. The
        // durable Conversation.workOrderPath is the source of truth once bound.
        tab.workOrderPath = null;
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
        tab.workOrderPath = null;
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
    // Surface the tab-pinned model so `InputController` can forward it as a
    // per-turn `queryOptions.model` override. Required for Agent Board task
    // runs where the work-order's selected model differs from the provider's
    // global `settings.model`.
    //
    // Resolution order:
    //   1. `pinnedModel` — sticks past runtime init; covers every turn on a
    //      task-run tab (work-order model honored on the 2nd, 3rd, etc. send too).
    //   2. `draftModel` on a blank tab — covers regular chat tabs where the
    //      user has picked a model in the composer but hasn't sent yet (the
    //      draft survives only until init clears it).
    //   3. null otherwise — bound tabs fall back to global `settings.model`.
    getTabModelOverride: () => {
      if (typeof tab.pinnedModel === 'string' && tab.pinnedModel.trim()) {
        return tab.pinnedModel.trim();
      }
      if (tab.lifecycleState === 'blank' && typeof tab.draftModel === 'string' && tab.draftModel.trim()) {
        return tab.draftModel.trim();
      }
      return null;
    },
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

        // Transition: lock model selector to bound provider
        refreshTabProviderUI(tab, plugin);
        applyProviderUIGating(tab, plugin);
        return true;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : t('chat.input.chatServiceInitFailed'));
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

