import type ClaudianPlugin from '../../../main';
import type { TaskSpec } from '../model/taskTypes';

/**
 * Build the `onOpenConversation` / `canOpenConversation` callback pair used by
 * both the work-order detail modal and the WO card right-click context menu.
 *
 * Both surfaces must gate "Open conversation" on the same composed rule:
 *   the WO has a `conversation_id` AND `plugin.getConversationSync(conversation_id)`
 *   still resolves to a live conversation.
 *
 * Extracting this here means both call sites share one source of truth — when
 * the conversation lookup or gating semantics change, neither surface drifts.
 */
export function buildWorkOrderConversationBindings(plugin: ClaudianPlugin): {
  onOpenConversation: (task: TaskSpec) => void;
  canOpenConversation: (task: TaskSpec) => boolean;
} {
  return {
    onOpenConversation: (task) => {
      const conversationId = task.frontmatter.conversation_id;
      // Always open in a fresh tab so a click on a work-order card never
      // hijacks (and closes) an unrelated streaming session in the active
      // tab. If the tab cap is full, the TabManager surfaces a Notice.
      if (conversationId) void plugin.openConversation(conversationId, { requireNewTab: true });
    },
    canOpenConversation: (task) => {
      const conversationId = task.frontmatter.conversation_id;
      return Boolean(conversationId && plugin.getConversationSync(conversationId));
    },
  };
}
