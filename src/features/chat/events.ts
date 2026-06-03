export interface ChatEventMap {
  /** Emitted when a chat tab is opened or closed. */
  'chat:tabs-changed': { openCount: number };
  /**
   * Emitted when a conversation's title changes (manual rename or auto-title).
   * Listeners reading conversation titles for UI (header title, history
   * dropdown, tab bar) refresh in response. The payload carries only the
   * conversation id + new title — consumers look up the full conversation
   * through `plugin.getConversationSync(id)` if they need more.
   */
  'conversation:renamed': { conversationId: string; title: string };
}
