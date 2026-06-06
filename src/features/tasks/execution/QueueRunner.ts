import type { ChatTabReservation, ChatTabReservations } from '../../../core/chatTabReservations';
import type { TaskEventMap } from '../events';
import { isRunnableTaskStatus } from '../model/taskStateMachine';
import type { TaskLedgerEntry, TaskSpec } from '../model/taskTypes';
import type { QueueSlotTracker } from './QueueSlotTracker';
import type { EligibilityPredicates } from './selectNextEligibleTask';
import { selectNextEligibleTask, taskIneligibilityReason } from './selectNextEligibleTask';
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
  run(task: TaskSpec, reservation?: ChatTabReservation): Promise<TaskRunResult>;
  isActive(taskId: string): boolean;
}

/**
 * The queue's global control state. Every Agent Board pane is a window onto the
 * same work-order folder, so pause/halt/failure-count are one logical thing.
 * A single instance is shared by all per-board runners (owned at plugin level),
 * making a pause or auto-halt in any pane take effect everywhere with no
 * per-event propagation.
 */
export interface QueueControlState {
  paused: boolean;
  halted: boolean;
  haltReason: string | null;
  consecutiveFailures: number;
  /** Last skip reason and time per task, shared so the 60s skip-ledger debounce
   * is global: two panes skipping the same ineligible card write one ledger line,
   * not one each. */
  lastSkipReasonByTask: Map<string, { reason: string; at: number }>;
}

export function createQueueControlState(paused = false): QueueControlState {
  return {
    paused,
    halted: false,
    haltReason: null,
    consecutiveFailures: 0,
    lastSkipReasonByTask: new Map(),
  };
}

export interface QueueRunnerDeps {
  slot: QueueSlotTracker;
  getTasks: () => TaskSpec[];
  eligibility: EligibilityPredicates;
  coordinator: QueueRunnerCoordinator;
  appendLedger: (task: TaskSpec, entry: TaskLedgerEntry) => Promise<void>;
  events: QueueRunnerEvents;
  haltAfterFailures: number;
  /** Shared global control state. When omitted, the runner owns a private one
   * seeded from `initialPaused` (used by tests and single-runner contexts). */
  control?: QueueControlState;
  /** Seed for a private control state when `control` is not supplied. */
  initialPaused?: boolean;
  now: () => number;
  // Free execution (chat-tab) slots available right now. A run consumes a chat
  // tab; when the panel is at maxTabs the runtime fails the run, so the queue
  // must wait rather than launch and corrupt a ready card. Omitted ⇒ unbounded.
  getFreeExecutionSlots?: () => number;
  // Re-reads a work order from disk just before launch, returning the current
  // spec or null if it's gone/unparseable. Lets the queue skip a stale cached
  // card whose status changed since the board last indexed (e.g. completed or
  // edited) instead of overwriting it. Omitted ⇒ run the cached spec.
  reloadTask?: (task: TaskSpec) => Promise<TaskSpec | null>;
  // Shared chat-tab reservation ledger. The runner reserves a tab synchronously
  // at launch — before the async reload — so a second pane woken by the same
  // event sees the pending reservation and can't double-book the same free tab.
  reservations?: ChatTabReservations;
}

interface QueueRunnerState {
  haltAfterFailures: number;
}

const SKIP_DEBOUNCE_MS = 60_000;

// Matches the agentBoardQueueHaltAfter settings default. Clearing the settings
// field writes `undefined`, and Math.max(1, undefined) is NaN — which would
// disable auto-halt (consecutiveFailures >= NaN is always false). Fall back to
// this for any non-finite threshold.
const DEFAULT_HALT_AFTER_FAILURES = 3;

function clampHaltAfterFailures(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : DEFAULT_HALT_AFTER_FAILURES;
}

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
  // Shared across every board's runner so pause/halt/failure-count are global.
  private readonly control: QueueControlState;
  private pending = false;
  private running = false;
  private disposed = false;

  constructor(private readonly deps: QueueRunnerDeps) {
    this.control = deps.control ?? createQueueControlState(deps.initialPaused ?? false);
    this.state = {
      haltAfterFailures: clampHaltAfterFailures(deps.haltAfterFailures),
    };
  }

  isPaused(): boolean {
    return this.control.paused;
  }

  isHalted(): boolean {
    return this.control.halted;
  }

  getConsecutiveFailures(): number {
    return this.control.consecutiveFailures;
  }

  getHaltReason(): string | null {
    return this.control.haltReason;
  }

  getSkipReason(taskId: string): string | null {
    return this.control.lastSkipReasonByTask.get(taskId)?.reason ?? null;
  }

  clearSkipReason(taskId: string): void {
    this.control.lastSkipReasonByTask.delete(taskId);
  }

  // Mutates the shared control state, so a toggle in one pane pauses every
  // pane's runner; the emit just tells the other panes to repaint their chrome.
  setPaused(next: boolean): void {
    this.control.paused = next;
    if (next) {
      this.deps.events.emit('task:queue-paused');
    } else {
      this.deps.events.emit('task:queue-resumed');
      this.tick();
    }
  }

  setHalted(reason: string): void {
    this.control.halted = true;
    this.control.haltReason = reason;
    this.deps.events.emit('task:queue-halted', { reason });
  }

  clearHalt(): void {
    this.control.halted = false;
    this.control.haltReason = null;
    this.control.consecutiveFailures = 0;
  }

  setHaltAfterFailures(next: number): void {
    this.state.haltAfterFailures = clampHaltAfterFailures(next);
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
    if (this.control.paused || this.control.halted) return;
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
    this.control.lastSkipReasonByTask.delete(task.frontmatter.id);
    // Reserve the chat tab synchronously now, before runAcquired's async reload,
    // so another pane woken by the same event counts this committed-but-uncreated
    // tab and won't over-launch into the cap.
    void this.runAcquired(task, this.deps.reservations?.reserve());
  }

  // Re-read the work order immediately before running so the queue never starts
  // a stale cached spec — e.g. the card was completed or edited after the board's
  // last index but before this wake. Manual runs already pass a freshly-parsed
  // spec; this gives the queue path the same guarantee. The slot is already held
  // (acquired in launch); release it on a stale skip so the loop can advance.
  private async runAcquired(task: TaskSpec, reservation?: ChatTabReservation): Promise<void> {
    const id = task.frontmatter.id;
    let fresh: TaskSpec | null = task;
    if (this.deps.reloadTask) {
      try {
        fresh = await this.deps.reloadTask(task);
      } catch {
        fresh = null;
      }
    }
    if (!fresh || !isRunnableTaskStatus(fresh.frontmatter.status)) {
      // The note changed since indexing (completed, reworked, already running,
      // or deleted). Don't overwrite it; free the slot and the reservation.
      // Deliberately do not self-tick: the same change raises a vault event that
      // re-indexes and ticks the runner, so re-driving here would risk a tight
      // loop while the model still shows the card as runnable.
      reservation?.release();
      this.deps.slot.release(id);
      return;
    }
    // Eligibility can change between indexing and this wake (the note's
    // provider/model was edited, or a provider was disabled). Re-check the fresh
    // spec and skip — as selection would — rather than handing it to the
    // coordinator, whose guard rejection onSettle() would count as a failure and
    // could halt the whole queue.
    const ineligibility = taskIneligibilityReason(fresh, this.deps.eligibility);
    if (ineligibility) {
      this.recordSkip(fresh, ineligibility);
      reservation?.release();
      this.deps.slot.release(id);
      return;
    }
    this.deps.events.emit('task:queue-tick', { taskId: id });
    let result: TaskRunResult;
    try {
      // Hand the reservation to the coordinator so the chat view releases it at
      // tab creation; the finally below is an idempotent safety net.
      result = await this.deps.coordinator.run(fresh, reservation);
    } catch (err) {
      result = { ok: false, error: String(err) };
    } finally {
      reservation?.release();
      this.deps.slot.release(id);
    }
    // A startup failure (no chat tab/view available) is environmental, not a card
    // failure: record a debounced skip and wait for a capacity change
    // (chat:tabs-changed re-ticks) rather than hot-retrying the same still-ready
    // card and counting it toward the auto-halt streak.
    if (!result.ok && result.startupFailed) {
      this.recordSkip(fresh, result.error);
      return;
    }
    this.onSettle(result);
    this.tick();
  }

  private onSettle(res: TaskRunResult): void {
    if (res.ok) {
      this.control.consecutiveFailures = 0;
      return;
    }
    // A cancellation is a user action, not a provider failure — leave the streak
    // untouched (neither bump nor reset) so canceling queued runs can't trip the
    // auto-halt guard.
    if (res.canceled) return;
    this.control.consecutiveFailures += 1;
    if (this.control.consecutiveFailures >= this.state.haltAfterFailures) {
      this.setHalted(`${this.control.consecutiveFailures} consecutive failures · last: ${res.error}`);
    }
  }

  private recordSkip(task: TaskSpec, reason: string): void {
    const now = this.deps.now();
    const prev = this.control.lastSkipReasonByTask.get(task.frontmatter.id);
    const isNewReason = !prev || prev.reason !== reason;
    const windowElapsed = prev ? now - prev.at > SKIP_DEBOUNCE_MS : true;
    // Same reason inside the debounce window: keep the existing chip but stay
    // quiet — no event storm and no ledger spam while the card sits ineligible.
    // The map lives on the shared control, so this debounce is global across
    // every open board's runner, not per-pane.
    if (!isNewReason && !windowElapsed) return;

    this.control.lastSkipReasonByTask.set(task.frontmatter.id, { reason, at: now });
    this.deps.events.emit('task:queue-skipped', { taskId: task.frontmatter.id, reason });
    void this.deps.appendLedger(task, {
      timestamp: new Date(now).toISOString(),
      // The queue runs both Ready and Needs-fix cards; record the card's real
      // status so the ledger doesn't claim a Needs-fix card was Ready.
      status: task.frontmatter.status,
      message: `queue: skipped (${reason})`,
    });
  }
}
