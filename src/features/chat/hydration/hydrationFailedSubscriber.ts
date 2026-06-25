import { Notice } from 'obsidian';

import type { SpecoratorEventMap } from '../../../app/events/specoratorEvents';
import type { EventBus } from '../../../core/events/EventBus';
import type { HistoryLoadErrorCode } from '../../../core/providers/types';

export interface HydrationFailedBannerPayload {
  code: HistoryLoadErrorCode;
  message: string;
}

export type HydrationBannerRenderer = (
  conversationId: string,
  payload: HydrationFailedBannerPayload,
) => void;

/**
 * Subscribes to `conversation:hydration-failed` and surfaces the failure two ways:
 *   1. an Obsidian `Notice` so the user sees the error even if the conversation
 *      pane is not the active tab.
 *   2. an inline banner inside the conversation pane (via `renderBanner`) so the
 *      pane is not blank — this replaces the in-stream sentinel that Opencode
 *      previously used for the same purpose (removed in Task 4).
 *
 * Returns the bus disposer so the caller can tie cleanup to its own lifecycle.
 */
export function registerHydrationFailedSubscriber(
  events: EventBus<SpecoratorEventMap>,
  renderBanner: HydrationBannerRenderer,
): () => void {
  return events.on('conversation:hydration-failed', (payload) => {
    new Notice(payload.message);
    renderBanner(payload.conversationId, { code: payload.code, message: payload.message });
  });
}
