import { formatDurationMmSs } from '../../../utils/date';
import { FLAVOR_TEXTS, STREAMING_RESPONSE_LABEL } from '../constants';
import type { ChatState } from '../state/ChatState';

export interface StreamingIndicatorDeps {
  state: ChatState;
  getMessagesEl: () => HTMLElement;
  updateQueueIndicator: () => void;
}

/**
 * Owns the streaming status indicator shown beneath the active assistant turn:
 * the debounced "thinking" flavor indicator and the immediate "Writing
 * response..." placeholder used in collapse mode. Both share one DOM element and
 * a 1s `esc to interrupt` timer, tracked on the shared {@link ChatState} so the
 * rest of the stream pipeline can read `state.thinkingEl`.
 */
export class StreamingIndicator {
  /** Debounce delay before showing the thinking indicator (ms). */
  private static readonly DELAY = 400;

  constructor(private deps: StreamingIndicatorDeps) {}

  /**
   * Schedules showing the thinking indicator after a delay.
   * If content arrives before the delay, the indicator won't show.
   * This prevents the indicator from appearing during active streaming.
   * Note: Flavor text is hidden when model thinking block is active (thinking takes priority).
   */
  show(overrideText?: string, overrideCls?: string): void {
    const { state } = this.deps;

    // Early return if no content element
    if (!state.currentContentEl) return;

    // Clear any existing timeout
    if (state.thinkingIndicatorTimeout) {
      const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(timerWindow);
    }

    // Don't show flavor text while model thinking block is active
    if (state.currentThinkingState) {
      return;
    }

    // If indicator already exists, just re-append it to the bottom
    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator();
      return;
    }

    // Schedule showing the indicator after a delay
    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
      state.setThinkingIndicatorTimeout(null, null);
      // Double-check we still have a content element, no indicator exists, and no thinking block
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      this.render(text, overrideCls);
    }, StreamingIndicator.DELAY), timerWindow);
  }

  /**
   * Immediately shows (or relabels) the streaming placeholder for collapse mode.
   * Unlike {@link show}, this bypasses the debounce — a continuous text-only
   * answer never produces the 400ms idle gap the debounce waits for, so the
   * placeholder must appear as soon as text starts streaming.
   */
  showWriting(): void {
    const { state } = this.deps;
    if (!state.currentContentEl || state.currentThinkingState) return;

    if (state.thinkingIndicatorTimeout) {
      state.clearThinkingIndicatorTimeout(state.currentContentEl.ownerDocument.defaultView ?? null);
    }

    if (state.thinkingEl) {
      const labelSpan = state.thinkingEl.querySelector<HTMLElement>('.specorator-thinking-flavor');
      labelSpan?.setText(STREAMING_RESPONSE_LABEL);
      state.currentContentEl.appendChild(state.thinkingEl);
    } else {
      this.render(STREAMING_RESPONSE_LABEL);
    }
    this.deps.updateQueueIndicator();
  }

  /** Hides the thinking indicator and cancels any pending show timeout. */
  hide(): void {
    const { state } = this.deps;

    // Cancel any pending show timeout
    if (state.thinkingIndicatorTimeout) {
      const activeWindow = this.deps.getMessagesEl().ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(activeWindow);
    }

    // Clear timer interval (but preserve responseStartTime for duration capture)
    state.clearFlavorTimerInterval();

    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
  }

  /**
   * Builds the streaming-indicator DOM (label span + live `esc to interrupt`
   * timer) and starts its 1s timer. Shared by the debounced thinking indicator
   * and the immediate writing placeholder. The label span carries a stable class
   * so the writing path can relabel an already-mounted indicator.
   */
  private render(text: string, overrideCls?: string): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    const cls = overrideCls ? `specorator-thinking ${overrideCls}` : 'specorator-thinking';
    state.thinkingEl = state.currentContentEl.createDiv({ cls });
    state.thinkingEl.createSpan({ cls: 'specorator-thinking-flavor', text });

    // Create timer span with initial value
    const timerSpan = state.thinkingEl.createSpan({ cls: 'specorator-thinking-hint' });
    const updateTimer = () => {
      if (!state.responseStartTime) return;
      // Check if element is still connected to DOM (prevents orphaned interval updates)
      if (!timerSpan.isConnected) {
        if (state.flavorTimerInterval) {
          state.clearFlavorTimerInterval();
        }
        return;
      }
      const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
      timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
    };
    updateTimer(); // Initial update

    // Start interval to update timer every second
    if (state.flavorTimerInterval) {
      state.clearFlavorTimerInterval();
    }
    const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setFlavorTimerInterval(thinkingWindow.setInterval(updateTimer, 1000), thinkingWindow);
  }
}
