import type { TaskEventMap } from '../events';
import type { TaskLedgerEntry, TaskSpec } from '../model/taskTypes';
import type { QueueSlotTracker } from './QueueSlotTracker';
import type { EligibilityPredicates } from './selectNextEligibleTask';
import { selectNextEligibleTask } from './selectNextEligibleTask';
import type { TaskRunResult } from './TaskRunCoordinator';

// Variadic to mirror the shared EventBus exactly so a plain
// `EventBus<ClaudianEventMap>` satisfies this without an adapter: void events
// take no payload arg, the rest take one.
export interface QueueRunnerEvents {
  emit<K extends keyof TaskEventMap>(
    event: K,
    ...args: TaskEventMap[K] extends void ? [] : [TaskEventMap[K]]
  ): void;
  on<K extends keyof TaskEventMap>(event: K, handler: (payload: TaskEventMap[K]) => void): () => void;
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
  // Free execution (chat-tab) slots available right now. A run consumes a chat
  // tab; when the panel is at maxTabs the runtime fails the run, so the queue
  // must wait rather than launch and corrupt a ready card. Omitted ⇒ unbounded.
  getFreeExecutionSlots?: () => number;
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

  // User-initiated pause/resume: emits so other open boards can align via
  // applyPaused (which does not re-emit, so there is no event echo).
  setPaused(next: boolean): void {
    this.state.paused = next;
    if (next) {
      this.deps.events.emit('task:queue-paused');
    } else {
      this.deps.events.emit('task:queue-resumed');
      this.tick();
    }
  }

  // Align to a (persisted) pause state without emitting — used when a board
  // reloads the global queue config after another board toggled it.
  applyPaused(next: boolean): void {
    if (this.state.paused === next) return;
    this.state.paused = next;
    if (!next) this.tick();
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
    // Track free chat tabs locally and decrement per launch: a launched run's
    // tab opens asynchronously, so re-reading the live count mid-drain would
    // over-launch beyond the tabs actually available.
    let freeExecutionSlots = this.deps.getFreeExecutionSlots?.() ?? Number.POSITIVE_INFINITY;
    while (this.deps.slot.hasFreeSlot() && freeExecutionSlots > 0) {
      const pick = selectNextEligibleTask(this.deps.getTasks(), this.deps.eligibility, excluded);
      if (!pick) return;
      excluded.add(pick.task.frontmatter.id);
      if (pick.kind === 'skipped') {
        this.recordSkip(pick.task, pick.reason);
        continue;
      }
      this.launch(pick.task);
      freeExecutionSlots -= 1;
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
