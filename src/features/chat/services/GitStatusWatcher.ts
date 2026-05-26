import type { GitService, GitStatus } from './GitService';

type Subscriber = (status: GitStatus) => void;

const DEFAULT_INTERVAL_MS = 7000;

export class GitStatusWatcher {
  private subscribers = new Set<Subscriber>();
  private lastStatus: GitStatus | null = null;
  private timer: number | null = null;

  constructor(
    private readonly gitService: GitService,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  getLastStatus(): GitStatus | null {
    return this.lastStatus;
  }

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    if (this.lastStatus) {
      cb(this.lastStatus);
    }
    if (this.subscribers.size === 1) {
      this.start();
    }
    return () => this.unsubscribe(cb);
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  /** Final teardown (e.g. plugin unload). Clears the polling interval; does not clear subscribers. */
  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private start(): void {
    void this.poll();
    if (this.timer === null) {
      this.timer = window.setInterval(() => void this.poll(), this.intervalMs);
    }
  }

  private async poll(): Promise<void> {
    try {
      const next = await this.gitService.getStatus();
      if (!this.lastStatus || !this.statusEquals(this.lastStatus, next)) {
        this.lastStatus = next;
        for (const cb of this.subscribers) {
          cb(next);
        }
      }
    } catch {
      // Keep last good status on transient failures.
    }
  }

  private unsubscribe(cb: Subscriber): void {
    this.subscribers.delete(cb);
    if (this.subscribers.size === 0) {
      this.stop();
    }
  }

  private statusEquals(a: GitStatus, b: GitStatus): boolean {
    return a.isRepo === b.isRepo && a.dirtyCount === b.dirtyCount;
  }
}
