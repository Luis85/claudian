import type { TaskEventMap } from '../events';
import type { TaskLedgerEntry, TaskSpec } from '../model/taskTypes';
import { selectNextEligibleTask } from './selectNextEligibleTask';
import type { EligibilityPredicates } from './selectNextEligibleTask';
import type { QueueSlotTracker } from './QueueSlotTracker';
import type { TaskRunResult } from './TaskRunCoordinator';

export interface QueueRunnerEvents {
  emit<K extends keyof TaskEventMap>(name: K, payload: TaskEventMap[K]): void;
  on<K extends keyof TaskEventMap>(name: K, handler: (payload: TaskEventMap[K]) => void): () => void;
}

export interface QueueRunnerCoordinator {
  run(task: TaskSpec): Promise<TaskRunResult>;
  isActive(taskId: string): boolean;
}

export interface QueueRunnerDeps {
  slot: QueueSlotTracker;
  getTasks: () => TaskSpec[];
  eligibility: EligibilityPredicates;
  coordinator: QueueRunnerCoordinator;
  appendLedger: (task: TaskSpec, entry: TaskLedgerEntry) => Promise<void>;
  events: QueueRunnerEvents;
  haltAfterFailures: number;
  initialPaused: boolean;
  now: () => number;
}

interface QueueRunnerState {
  paused: boolean;
  halted: boolean;
  haltReason: string | null;
  consecutiveFailures: number;
  haltAfterFailures: number;
  lastSkipReasonByTask: Map<string, { reason: string; at: number }>;
}

const SKIP_DEBOUNCE_MS = 60_000;

/**
 * Per-board background loop. On each `tick()` it drains free slots by picking
 * the next eligible Ready/Needs-fix card and handing it to the shared
 * `TaskRunCoordinator`. Concurrency is bounded by the plugin-level
 * `QueueSlotTracker`; consecutive auto-run failures auto-halt the loop.
 *
 * `tick()` is cheap and idempotent — callers fire it on any event that could
 * change eligibility (status change, run finished, settings change). A reentry
 * guard collapses overlapping ticks into one trailing pass.
 */
export class QueueRunner {
  private readonly state: QueueRunnerState;
  private pending = false;
  private running = false;
  private disposed = false;

  constructor(private readonly deps: QueueRunnerDeps) {
    this.state = {
      paused: deps.initialPaused,
      halted: false,
      haltReason: null,
      consecutiveFailures: 0,
      haltAfterFailures: Math.max(1, deps.haltAfterFailures),
      lastSkipReasonByTask: new Map(),
    };
  }

  isPaused(): boolean {
    return this.state.paused;
  }

  isHalted(): boolean {
    return this.state.halted;
  }

  getConsecutiveFailures(): number {
    return this.state.consecutiveFailures;
  }

  getHaltReason(): string | null {
    return this.state.haltReason;
  }

  getSkipReason(taskId: string): string | null {
    return this.state.lastSkipReasonByTask.get(taskId)?.reason ?? null;
  }

  clearSkipReason(taskId: string): void {
    this.state.lastSkipReasonByTask.delete(taskId);
  }

  setPaused(next: boolean): void {
    this.state.paused = next;
    if (next) {
      this.deps.events.emit('task:queue-paused', undefined as never);
    } else {
      this.deps.events.emit('task:queue-resumed', undefined as never);
      this.tick();
    }
  }

  setHalted(reason: string): void {
    this.state.halted = true;
    this.state.haltReason = reason;
    this.deps.events.emit('task:queue-halted', { reason });
  }

  clearHalt(): void {
    this.state.halted = false;
    this.state.haltReason = null;
    this.state.consecutiveFailures = 0;
  }

  setHaltAfterFailures(next: number): void {
    this.state.haltAfterFailures = Math.max(1, next);
  }

  dispose(): void {
    this.disposed = true;
  }

  tick(): void {
    if (this.disposed) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      this.doTick();
    } finally {
      this.running = false;
      if (this.pending) {
        this.pending = false;
        queueMicrotask(() => this.tick());
      }
    }
  }

  private doTick(): void {
    if (this.state.paused || this.state.halted) return;
    // Per-pass exclusion: consider each card at most once so a skip — or a
    // launch that already holds its slot — can never re-select the same card
    // and spin the loop. Cross-tick de-dup is handled by the coordinator's
    // in-flight set (eligibility.isActive) and by cards leaving Ready once run.
    const excluded = new Set<string>();
    while (this.deps.slot.hasFreeSlot()) {
      const pick = selectNextEligibleTask(this.deps.getTasks(), this.deps.eligibility, excluded);
      if (!pick) return;
      excluded.add(pick.task.frontmatter.id);
      if (pick.kind === 'skipped') {
        this.recordSkip(pick.task, pick.reason);
        continue;
      }
      this.launch(pick.task);
    }
  }

  private launch(task: TaskSpec): void {
    if (!this.deps.slot.acquire(task.frontmatter.id)) return;
    // The card is running now, so any stale skip chip no longer applies.
    this.state.lastSkipReasonByTask.delete(task.frontmatter.id);
    this.deps.events.emit('task:queue-tick', { taskId: task.frontmatter.id });
    this.deps.coordinator
      .run(task)
      .then((res) => this.onSettle(res))
      .catch((err) => this.onSettle({ ok: false, error: String(err) }))
      .finally(() => {
        this.deps.slot.release(task.frontmatter.id);
        this.tick();
      });
  }

  private onSettle(res: TaskRunResult): void {
    if (res.ok) {
      this.state.consecutiveFailures = 0;
      return;
    }
    this.state.consecutiveFailures += 1;
    if (this.state.consecutiveFailures >= this.state.haltAfterFailures) {
      this.setHalted(`${this.state.consecutiveFailures} consecutive failures · last: ${res.error}`);
    }
  }

  private recordSkip(task: TaskSpec, reason: string): void {
    const now = this.deps.now();
    const prev = this.state.lastSkipReasonByTask.get(task.frontmatter.id);
    const isNewReason = !prev || prev.reason !== reason;
    const windowElapsed = prev ? now - prev.at > SKIP_DEBOUNCE_MS : true;
    // Same reason inside the debounce window: keep the existing chip but stay
    // quiet — no event storm and no ledger spam while the card sits ineligible.
    if (!isNewReason && !windowElapsed) return;

    this.state.lastSkipReasonByTask.set(task.frontmatter.id, { reason, at: now });
    this.deps.events.emit('task:queue-skipped', { taskId: task.frontmatter.id, reason });
    void this.deps.appendLedger(task, {
      timestamp: new Date(now).toISOString(),
      status: 'ready',
      message: `queue: skipped (${reason})`,
    });
  }
}
