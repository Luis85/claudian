/**
 * Scrolls a messages container to its bottom without forcing a synchronous
 * full-document layout.
 *
 * The naive `el.scrollTop = el.scrollHeight` reads `scrollHeight`, which forces the
 * engine to lay out the entire (unbounded, never-pruned) message DOM. During streaming
 * this runs on every chunk, so the cost grows with conversation length — the root of the
 * long-chat slowdown. Scrolling the trailing child into view lets the browser perform
 * the work in its own batched layout pass instead of a blocking JS read.
 *
 * Falls back to the `scrollTop`/`scrollHeight` write only when no trailing element exists
 * (e.g. an empty container) so behavior is preserved in every case.
 */
export function scrollMessagesToBottom(messagesEl: HTMLElement): void {
  const anchor = messagesEl.lastElementChild as HTMLElement | null;
  if (anchor && typeof anchor.scrollIntoView === 'function') {
    anchor.scrollIntoView({ block: 'end' });
    return;
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}
