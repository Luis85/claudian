import type { Conversation } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import type { TabData } from '../tabs/types';

function getTabConversation(tab: TabData, plugin: ClaudianPlugin): Conversation | null {
  const conversationId = tab.conversationId ?? tab.state.currentConversationId;
  return conversationId ? plugin.getConversationSync(conversationId) : null;
}

export function isOrchestratorModeActive(tab: TabData, plugin: ClaudianPlugin): boolean {
  if (tab.orchestratorTabId) {
    return false;
  }
  if (tab.state.pendingOrchestratorMode) {
    return true;
  }
  return getTabConversation(tab, plugin)?.orchestratorMode === true;
}

export async function setOrchestratorModeActive(
  tab: TabData,
  plugin: ClaudianPlugin,
  active: boolean,
): Promise<void> {
  if (tab.orchestratorTabId) {
    return;
  }

  if (!active) {
    tab.state.pendingOrchestratorMode = false;
    const conversation = getTabConversation(tab, plugin);
    if (conversation?.orchestratorMode) {
      await plugin.updateConversation(conversation.id, { orchestratorMode: false });
    }
  } else {
    const conversation = getTabConversation(tab, plugin);
    if (conversation) {
      if (!conversation.orchestratorMode) {
        await plugin.updateConversation(conversation.id, { orchestratorMode: true });
      }
    } else {
      tab.state.pendingOrchestratorMode = true;
    }
  }

  syncOrchestratorModeUI(tab, plugin);
}

export function syncOrchestratorModeUI(tab: TabData, plugin: ClaudianPlugin): void {
  const enabled = plugin.settings.orchestratorEnabled !== false && !tab.orchestratorTabId;
  const active = enabled && isOrchestratorModeActive(tab, plugin);
  tab.ui.orchestratorToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass('claudian-input-orchestrator-mode', active);
}
