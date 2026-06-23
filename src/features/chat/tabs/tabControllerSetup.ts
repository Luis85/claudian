import type { Component } from 'obsidian';
import { Notice } from 'obsidian';

import { getEnabledProviderForModel } from '../../../core/providers/modelRouting';
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

/**
 * Per-tab controller wiring extracted from `initializeTabControllers`.
 *
 * Each builder mutates `tab.renderer` / `tab.controllers` in place and is
 * invoked in a fixed order by the orchestrator. The order matters: later
 * builders read controllers (and the renderer) constructed by earlier ones,
 * so these functions are not independently reorderable. Fork affordances are
 * passed in as already-bound callbacks so this module never imports the fork
 * handlers from `tabControllers.ts` (which would form an import cycle).
 */

/**
 * Structural view of the host (`ClaudianView`) that owns pending hydration
 * failures. Declared locally to avoid importing the view type (circular import).
 */
interface PendingHydrationErrorHost {
  consumePendingHydrationError(conversationId: string): { code: string; message: string } | null;
}

/**
 * Builds the tab's `MessageRenderer` and assigns it to `tab.renderer`.
 * Returns nothing — later builders read `tab.renderer` directly.
 */
export function buildTabMessageRenderer(
  tab: TabData,
  plugin: ClaudianPlugin,
  component: Component,
  forkMessageCallback?: (userMessageId: string) => Promise<void>,
): void {
  const { dom } = tab;

  tab.renderer = new MessageRenderer(plugin, component, dom.messagesEl, {
    rewindCallback: (id, mode) => tab.controllers.conversationController!.rewind(id, mode),
    forkCallback: forkMessageCallback ? (id) => forkMessageCallback(id) : undefined,
    getCapabilities: () => getTabCapabilities(tab, plugin),
    getWorkOrderPath: () =>
      tab.workOrderPath
      ?? (tab.conversationId
        ? plugin.getConversationSync(tab.conversationId)?.workOrderPath ?? null
        : null),
  });
}

/** Builds the editor/browser/canvas selection controllers. */
export function buildTabSelectionControllers(tab: TabData, plugin: ClaudianPlugin): void {
  const { dom } = tab;

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
}

/**
 * Builds the `StreamController` and wires the subagent persistence callback,
 * which must run after the controller exists (the callback forwards async
 * subagent state into it).
 */
export function buildTabStreamController(tab: TabData, plugin: ClaudianPlugin): void {
  const { dom, state, services, ui } = tab;

  // The orchestrator builds the renderer before this builder, so it is present.
  const renderer = tab.renderer!;

  tab.controllers.streamController = new StreamController({
    plugin,
    state,
    renderer,
    subagentManager: services.subagentManager,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    updateQueueIndicator: () => tab.controllers.inputController?.updateQueueIndicator(),
    getAgentService: () => tab.service,
    onRetryLastTurn: () => tab.controllers.inputController?.retryLastTurn(),
  });

  // Wire subagent callback now that StreamController exists.
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
}

/** Builds the `ConversationController` (session switching, save, rewind, rebind). */
export function buildTabConversationController(
  tab: TabData,
  plugin: ClaudianPlugin,
  component: Component,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
): void {
  const { dom, state, services, ui } = tab;

  // The orchestrator builds the renderer before this builder, so it is present.
  const renderer = tab.renderer!;

  tab.controllers.conversationController = new ConversationController(
    {
      plugin,
      state,
      renderer,
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
}

/** Builds the `InputController` (text input, dispatch, post-plan approval). */
export function buildTabInputController(
  tab: TabData,
  plugin: ClaudianPlugin,
  openConversation?: (conversationId: string) => Promise<void>,
  forkAllCallback?: () => Promise<void>,
): void {
  const { dom, state, services, ui } = tab;

  // The orchestrator builds the renderer and these controllers before this
  // builder, so all are present at this point.
  const renderer = tab.renderer!;
  const { controllers } = tab;

  tab.controllers.inputController = new InputController({
    plugin,
    state,
    renderer,
    streamController: controllers.streamController!,
    selectionController: controllers.selectionController!,
    browserSelectionController: controllers.browserSelectionController!,
    canvasSelectionController: controllers.canvasSelectionController!,
    conversationController: controllers.conversationController!,
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
    // Roster agent binding: consumed once by `triggerTitleGeneration` on the
    // first send, after which the tab clears the id so a rebind or
    // new-conversation action doesn't carry a stale roster id. Parallel to
    // `getWorkOrderPath` which guards the work-order note path similarly.
    getBoundAgentId: () => {
      const id = tab.boundAgentId;
      // Consume-once: clear after the caller reads it so subsequent lazy
      // conversation creates (new conversation, fork, etc.) don't inherit it.
      tab.boundAgentId = null;
      return id;
    },
    openConversation,
    onForkAll: forkAllCallback ? () => forkAllCallback() : undefined,
    restorePrePlanPermissionModeIfNeeded: () => {
      if (getTabPermissionMode(tab, plugin) === 'plan') {
        const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
        tab.state.prePlanPermissionMode = null;
        updatePlanModeUI(tab, plugin, restoreMode);
      }
    },
  });
}

/** Builds the `NavigationController` and initializes it. */
export function buildTabNavigationController(tab: TabData, plugin: ClaudianPlugin): void {
  const { dom, state, ui } = tab;

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
