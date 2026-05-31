import type ClaudianPlugin from '../../../main';
import type { TabData } from './types';

export { getTabProviderId } from './providerResolution';
export {
  type ForkContext,
  initializeTabControllers,
  setupServiceCallbacks,
} from './tabControllers';
export {
  createTab,
  type TabCreateOptions,
} from './tabFactory';
export { wireTabInputEvents } from './tabInputWiring';
export {
  activateTab,
  deactivateTab,
  destroyTab,
  initializeTabService,
} from './tabLifecycle';
export {
  getBlankTabModelOptions,
  resolveBlankTabDefaultProviderId,
} from './tabModelPolicy';
export { onProviderAvailabilityChanged } from './tabProviderSync';
export { updatePlanModeUI } from './tabShared';
export {
  initializeTabUI,
  type InitializeTabUIOptions,
  maybeWarnYoloMode,
} from './tabUi';

/**
 * Gets the display title for a tab.
 * Uses synchronous access since we only need the title, not messages.
 */
export function getTabTitle(tab: TabData, plugin: ClaudianPlugin): string {
  if (tab.conversationId) {
    const conversation = plugin.getConversationSync(tab.conversationId);
    if (conversation?.title) {
      return conversation.title;
    }
  }
  return 'New Chat';
}
