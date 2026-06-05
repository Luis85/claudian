import type { TaskLedgerEntry } from '../model/taskTypes';

export interface LedgerWriterOptions {
  flush: (entries: TaskLedgerEntry[]) => Promise<void>;
  intervalMs: number;
  milestoneThreshold: number;
  onDegraded?: () => void;
}

const TAIL_CAP = 20;
const RETRY_BACKOFF_MS = [5000, 30000];

export class LedgerWriter {
  private queue: TaskLedgerEntry[] = [];
  private tailBuffer: TaskLedgerEntry[] = [];
  private timer: number | null = null;
  private flushInFlight: Promise<void> | null = null;
  private retryAttempt = 0;
  private disposed = false;

  constructor(private readonly opts: LedgerWriterOptions) {
    this.scheduleInterval();
  }

  enqueue(entry: TaskLedgerEntry): void {
    if (this.disposed) return;
    this.queue.push(entry);
    this.tailBuffer.push(entry);
    if (this.tailBuffer.length > TAIL_CAP) {
      this.tailBuffer.splice(0, this.tailBuffer.length - TAIL_CAP);
    }
    if (this.queue.length >= this.opts.milestoneThreshold) {
      void this.flushNow();
    }
  }

  async flushNow(): Promise<void> {
    // Wait for any in-flight flush first, so entries enqueued during it (e.g. a
    // run's final "Handoff written." line) are not stranded when a caller flushes
    // then disposes. Single-threaded execution guarantees only one flush runs at
    // a time, so this never double-writes a batch.
    if (this.flushInFlight) {
      await this.flushInFlight;
    }
    if (this.queue.length === 0) return;
    this.flushInFlight = this.doFlush();
    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }
  }

  private async doFlush(): Promise<void> {
    const batch = this.queue.slice();
    this.queue.length = 0;
    try {
      await this.opts.flush(batch);
      this.retryAttempt = 0;
    } catch {
      this.retryAttempt += 1;
      if (this.retryAttempt > RETRY_BACKOFF_MS.length) {
        this.opts.onDegraded?.();
      } else {
        // Re-queue at the front and schedule a retry.
        this.queue = [...batch, ...this.queue];
        this.scheduleRetry();
      }
    }
  }

  tail(): TaskLedgerEntry[] {
    return [...this.tailBuffer];
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleInterval(): void {
    if (this.disposed) return;
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flushNow().then(() => this.scheduleInterval());
    }, this.opts.intervalMs);
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    if (this.timer) window.clearTimeout(this.timer);
    const delay = RETRY_BACKOFF_MS[this.retryAttempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flushNow().then(() => this.scheduleInterval());
    }, delay);
  }
}
