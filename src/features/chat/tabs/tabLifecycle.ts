import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { Conversation } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { getTabProviderId } from './providerResolution';
import { createTabRuntimeHost } from './tabRuntimeHost';
import { isClosingLifecycleState, isConversationLike } from './tabShared';
import type { TabData } from './types';

/**
 * Initializes the tab's chat runtime for the send path.
 *
 * This is the ONLY place a runtime is created. Called from:
 * - ensureServiceInitialized() in InputController.sendMessage()
 *
 * Session sync is passive (state update only). The runtime is started
 * on demand by query() inside the send path.
 */
export async function initializeTabService(
  tab: TabData,
  plugin: ClaudianPlugin,
  conversationOverride?: Conversation | null,
): Promise<void>;
export async function initializeTabService(
  tab: TabData,
  plugin: ClaudianPlugin,
  _legacyArg: unknown,
  conversationOverride?: Conversation | null,
): Promise<void>;
export async function initializeTabService(
  tab: TabData,
  plugin: ClaudianPlugin,
  argOrOverride?: unknown,
  maybeOverride?: Conversation | null,
): Promise<void> {
  if (tab.lifecycleState === 'closing') {
    return;
  }

  // Support legacy 4-arg call sites (3rd arg was previously an MCP manager)
  const conversationOverride = isConversationLike(argOrOverride)
    ? argOrOverride
    : (argOrOverride === null ? null : maybeOverride);

  const conversation = conversationOverride ?? (
    tab.conversationId
      ? await plugin.getConversationById(tab.conversationId)
      : null
  );
  const providerId = getTabProviderId(tab, plugin, conversation);

  if (tab.serviceInitialized && tab.service?.providerId === providerId) {
    return;
  }

  let service: ChatRuntime | null = null;
  let unsubscribeReadyState: (() => void) | null = null;
  const previousService = tab.service;

  try {
    tab.service = null;
    tab.serviceInitialized = false;
    // Record the outgoing cleanup on the tab before awaiting (same pattern as
    // cleanupTabRuntime) so an overlapping initializeTabService awaits it via
    // tab.pendingRuntimeCleanup instead of constructing a replacement while the
    // old CLI process is still exiting.
    if (typeof previousService?.cleanup === 'function') {
      const cleanupPromise = Promise.resolve(previousService.cleanup()).finally(() => {
        if (tab.pendingRuntimeCleanup === cleanupPromise) {
          tab.pendingRuntimeCleanup = null;
        }
      });
      tab.pendingRuntimeCleanup = cleanupPromise;
      await cleanupPromise;
    }
    // A previous switch path may have detached and torn down a runtime
    // fire-and-forget (e.g. the new-conversation reset). Await that too so the
    // old process is fully gone before we construct a replacement.
    if (tab.pendingRuntimeCleanup) {
      await tab.pendingRuntimeCleanup;
    }

    // Construction-time UI host (ADR-0001 Phase 2): the host closes over live
    // tab state, so it is built once per runtime and never re-wired.
    const runtime = ProviderRegistry.createChatRuntime({
      plugin,
      providerId,
      host: createTabRuntimeHost(tab, plugin),
    });
    service = runtime;
    unsubscribeReadyState = runtime.onReadyStateChange(() => {});
    tab.dom.eventCleanups.push(() => unsubscribeReadyState?.());

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    if (conversation) {
      const hasMessages = conversation.messages.length > 0;
      const externalContextPaths = hasMessages
        ? conversation.externalContextPaths || []
        : (plugin.settings.persistentExternalContextPaths || []);

      runtime.syncConversationState(conversation, externalContextPaths);
    }

    // Re-check after async operations — tab may have been closed during init
    if (isClosingLifecycleState(tab.lifecycleState)) {
      unsubscribeReadyState?.();
      await service?.cleanup();
      return;
    }


    tab.providerId = providerId;
    tab.service = service;
    tab.serviceInitialized = true;

    // Update lifecycle state
    if (tab.lifecycleState === 'blank') {
      tab.draftModel = null;
    }
    tab.lifecycleState = 'bound_active';
  } catch (error) {
    // Clean up partial state on failure
    unsubscribeReadyState?.();
    await service?.cleanup();
    tab.service = null;
    tab.serviceInitialized = false;

    // Re-throw to let caller handle (e.g., show error to user)
    throw error;
  }
}

/**
 * Activates a tab (shows it and starts services).
 */
export function activateTab(tab: TabData): void {
  tab.dom.contentEl.removeClass('claudian-hidden');
  tab.controllers.selectionController?.start();
  tab.controllers.browserSelectionController?.start();
  tab.controllers.canvasSelectionController?.start();
  // Refresh navigation sidebar visibility (dimensions now available after display)
  tab.ui.navigationSidebar?.updateVisibility();
}

/**
 * Deactivates a tab (hides it and stops services).
 */
export function deactivateTab(tab: TabData): void {
  tab.dom.contentEl.addClass('claudian-hidden');
  tab.controllers.selectionController?.stop();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.canvasSelectionController?.stop();
}

/**
 * Cleans up a tab and releases all resources.
 * Made async to ensure proper cleanup ordering.
 */
export async function destroyTab(tab: TabData): Promise<void> {
  tab.lifecycleState = 'closing';

  tab.controllers.selectionController?.stop();
  tab.controllers.selectionController?.clear();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.browserSelectionController?.clear();
  tab.controllers.canvasSelectionController?.stop();
  tab.controllers.canvasSelectionController?.clear();
  tab.controllers.navigationController?.dispose();

  cleanupThinkingBlock(tab.state.currentThinkingState);
  tab.state.currentThinkingState = null;

  // Dismiss pending inline prompts before DOM teardown
  tab.controllers.inputController?.dismissPendingApproval();

  tab.controllers.inputController?.destroyResumeDropdown();
  tab.ui.fileContextManager?.destroy();
  tab.ui.chatDropController?.destroy();
  tab.ui.chatDropController = undefined;
  tab.ui.slashCommandDropdown?.destroy();
  tab.ui.slashCommandDropdown = null;
  tab.ui.instructionModeManager?.destroy();
  tab.ui.instructionModeManager = null;
  tab.ui.bangBashModeManager?.destroy();
  tab.ui.bangBashModeManager = null;
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = null;
  tab.services.titleGenerationService?.cancel();
  tab.services.titleGenerationService = null;
  tab.ui.statusPanel?.destroy();
  tab.ui.statusPanel = null;
  tab.ui.navigationSidebar?.destroy();
  tab.ui.navigationSidebar = null;

  tab.services.subagentManager.orphanAllActive();
  tab.services.subagentManager.clear();

  for (const cleanup of tab.dom.eventCleanups) {
    cleanup();
  }
  tab.dom.eventCleanups.length = 0;

  // Clean up runtime before removing DOM. Await so the provider subprocess is
  // actually killed before teardown completes (prevents orphaned CLI processes).
  await tab.service?.cleanup();
  tab.service = null;
  tab.dom.contentEl.remove();
}
