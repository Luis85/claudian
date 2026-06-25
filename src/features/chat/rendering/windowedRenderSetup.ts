/**
 * Trailing window of stored messages mounted on conversation load / switch / rewind.
 * Long chats otherwise mount unbounded DOM (~56 nodes + ~7 listeners per message),
 * making each re-mount O(N). Windowing bounds it to O(K): the trailing region — where
 * streaming and the bottom anchor live — is always mounted, and earlier messages mount
 * on demand through the "load earlier" control.
 */
export const RENDER_WINDOW_SIZE = 80;

/** First message index to mount, capping to the trailing window of {@link windowSize}. */
export function windowStartIndex(total: number, windowSize = RENDER_WINDOW_SIZE): number {
  return Math.max(0, total - windowSize);
}

/**
 * Shared opening sequence for the two stored-message render paths
 * ({@link MessageRenderer.renderMessages} and `renderMessagesChunked`). Both
 * recreate the welcome element, restore the hydration-error banner from state,
 * compute the trailing render window, and mount the "load earlier" control when
 * earlier messages are hidden. Generation bookkeeping stays with the caller
 * because the two paths consume it differently (one needs the bumped value).
 *
 * Assumes the caller has already `empty()`-ed `messagesEl` and reset live-element
 * tracking; this only rebuilds the post-clear scaffolding.
 */
export function setupWindowedRender(params: {
  messagesEl: HTMLElement;
  getGreeting: () => string;
  renderHydrationErrorBanner: () => void;
  renderLoadEarlierControl: () => void;
  total: number;
}): { welcomeEl: HTMLElement; start: number } {
  const { messagesEl, getGreeting, renderHydrationErrorBanner, renderLoadEarlierControl, total } = params;

  const welcomeEl = messagesEl.createDiv({ cls: 'specorator-welcome' });
  welcomeEl.createDiv({ cls: 'specorator-welcome-greeting', text: getGreeting() });

  renderHydrationErrorBanner();

  const start = windowStartIndex(total);
  if (start > 0) {
    renderLoadEarlierControl();
  }

  return { welcomeEl, start };
}
