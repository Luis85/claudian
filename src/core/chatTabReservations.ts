/** A single outstanding chat-tab reservation. Releasing is idempotent so the
 *  chat view (at tab creation) and the run coordinator (settle safety net) can
 *  both call it without underflowing the shared count. */
export interface ChatTabReservation {
  release(): void;
}

/**
 * Plugin-level count of chat tabs that queue runs have committed to opening but
 * whose tabs may not exist yet. Shared across every Agent Board pane so a launch
 * in one pane is visible to another pane's free-tab gate before the asynchronous
 * tab creation lands. Without it two panes can both read the same free-tab count
 * and over-launch into the tab cap, failing ready cards on the limit.
 */
export class ChatTabReservations {
  private outstanding = 0;

  /** Chat tabs reserved but not yet created. Added to live/persisted usage by
   *  the queue's free-tab gate. */
  get pending(): number {
    return this.outstanding;
  }

  reserve(): ChatTabReservation {
    this.outstanding += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.outstanding = Math.max(0, this.outstanding - 1);
      },
    };
  }
}
