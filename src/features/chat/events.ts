export interface ChatEventMap {
  /** Emitted when a chat tab is opened or closed. */
  'chat:tabs-changed': { openCount: number };
}
