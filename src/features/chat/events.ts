import type { HistoryLoadErrorCode } from '../../core/providers/types';

export interface ChatEventMap {
  /** Emitted when a chat tab is opened or closed. */
  'chat:tabs-changed': { openCount: number; chatCount: number; workOrderCount: number };
  /**
   * Emitted when a conversation's title changes (manual rename or auto-title).
   * Listeners reading conversation titles for UI (header title, history
   * dropdown, tab bar) refresh in response. The payload carries only the
   * conversation id + new title — consumers look up the full conversation
   * through `plugin.getConversationSync(id)` if they need more.
   */
  'conversation:renamed': { conversationId: string; title: string };
  /**
   * Emitted when a provider history service reports an `error` outcome from
   * either `hydrateConversationHistory` or `deleteConversationSession`.
   * The payload is the redacted user-safe summary from the provider; raw
   * detail strings stay confined to the leveled logger. Subscriber wiring is
   * a follow-up task — this event is produced today so callers can react
   * without inspecting `HistoryLoadOutcome` themselves.
   */
  'conversation:hydration-failed': {
    conversationId: string;
    code: HistoryLoadErrorCode;
    message: string;
  };
}
