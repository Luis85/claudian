import type { ChatMessage } from '@/core/types';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

export type FeedbackDirection = 'up' | 'down';

/**
 * Sends the i18n-backed thumbs-up or thumbs-down prompt as a normal user turn
 * on the tab that owns the rated message. Falls back to the active view's
 * active tab when no `conversationId` is supplied or no matching tab is found.
 *
 * Side-effect-free apart from the resulting `inputController.sendMessage`
 * dispatch. No persistence on the rated message.
 */
export function sendFeedbackPrompt(
  plugin: ClaudianPlugin,
  _message: ChatMessage,
  conversationId: string | null,
  direction: FeedbackDirection,
): void {
  const activeView = plugin.getView();
  if (!activeView) return;

  // Prefer the view+tab that owns the rated conversation so the feedback turn
  // lands in the correct chat across multi-view setups. Fall back to the
  // active view's active tab when no conversationId is supplied or no tab
  // matches (e.g. conversation moved tabs between render and click).
  let targetTab = activeView.getTabManager()?.getActiveTab() ?? null;
  if (conversationId) {
    const cross = plugin.findConversationAcrossViews(conversationId);
    if (cross) {
      targetTab = cross.view.getTabManager()?.getTab(cross.tabId) ?? targetTab;
    }
  }
  if (!targetTab) return;

  const promptKey =
    direction === 'up'
      ? 'chat.feedback.thumbsUp.prompt'
      : 'chat.feedback.thumbsDown.prompt';
  const content = t(promptKey);
  if (!content) {
    plugin.logger.scope('feedback').debug('empty prompt for direction', direction);
    return;
  }

  void targetTab.controllers.inputController?.sendMessage({ content });
}
