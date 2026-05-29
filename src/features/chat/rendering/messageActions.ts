import type { ChatMessage, ChatMessageAction } from '../../../core/types';

/**
 * Pure selector: keep only the registered actions eligible for `message`.
 * A predicate that throws is treated as ineligible so one bad action can never
 * break the toolbar.
 */
export function eligibleMessageActions(
  actions: ChatMessageAction[],
  message: ChatMessage,
): ChatMessageAction[] {
  return actions.filter((action) => {
    try {
      return action.isEligible(message);
    } catch {
      return false;
    }
  });
}
