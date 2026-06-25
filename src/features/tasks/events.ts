import type { EventBus } from '../../core/events/EventBus';
import type { TaskLedgerEntry, TaskStatus } from './model/taskTypes';

/**
 * Emit-only view of the event bus for task producers (RunSession, coordinator).
 * The app-level `EventBus<SpecoratorEventMap>` (a superset map) satisfies this, so
 * producers stay decoupled from chat/app event keys while still emitting task ones.
 */
export type TaskEventEmitter = Pick<EventBus<TaskEventMap>, 'emit'>;

export interface TaskEventMap {
  /** Emitted when Agent Board configuration (lanes/folder) changes. */
  'task:board-config-changed': void;
  /** Emitted when a work-order run begins. */
  'task:run-started': { taskId: string; path: string };
  /** Emitted whenever a work order's status is written. */
  'task:status-changed': { taskId: string; path: string; status: TaskStatus };
  /** Emitted when a work-order run ends. */
  'task:run-finished': { taskId: string; path: string; status: TaskStatus };

  /** Emitted at the start of every attempt entering `running`. */
  'task:attempt-started': { taskId: string; path: string; attemptNumber: number };
  /** Emitted whenever a ledger entry has been queued for write. */
  'task:ledger-appended': { taskId: string; path: string; entry: TaskLedgerEntry };
  /** Emitted on each heartbeat tick. */
  'task:heartbeat': { taskId: string; path: string; at: string };
  /** Emitted when the agent emits a <specorator_progress> block. */
  'task:progress': { taskId: string; path: string; step: string; done?: { complete: number; total: number } };
  /** Emitted when the run pauses for user input. */
  'task:needs-input': { taskId: string; path: string; question: string; why?: string; default?: string; runId: string };
  /** Emitted when the run pauses for user approval. */
  'task:needs-approval': { taskId: string; path: string; action: string; risk?: string; reversible?: boolean; runId: string };
  /** Emitted when the run resumes after a pause. */
  'task:resumed': { taskId: string; path: string };
  /** Emitted when a run ends without a parseable handoff but with content. */
  'task:needs-handoff': { taskId: string; path: string; error: string };
  /** Emitted when the parser drops a malformed specorator_* block. */
  'task:parser-warning': { taskId: string; path: string; warning: string };
  /** Emitted when LedgerWriter has given up flushing after retries. */
  'task:ledger-flush-degraded': { taskId: string; path: string };
  /**
   * Emitted when the terminal ledger snapshot couldn't be written into the
   * work-order note (e.g. the note was hand-edited and is missing the
   * `<!-- specorator:run-ledger-* -->` markers). The sidecar is left in place so
   * the ledger isn't lost — a developer can read `.specorator/runs/<runId>/ledger.jsonl`
   * directly.
   */
  'task:ledger-finalize-failed': { taskId: string; path: string; runId: string; error: string };

  /** Emitted when the queue runner launches a card. */
  'task:queue-tick': { taskId: string };
  /** Emitted when the user pauses the queue runner on a board. */
  'task:queue-paused': void;
  /** Emitted when the user resumes the queue runner on a board. */
  'task:queue-resumed': void;
  /** Emitted when the queue runner auto-halts after consecutive failures. */
  'task:queue-halted': { reason: string };
  /** Emitted when the runner skips a card for an eligibility reason. */
  'task:queue-skipped': { taskId: string; reason: string };
  /** Emitted when queue control state changes after a run settles or halt clears. */
  'task:queue-state-changed': void;
  /** Emitted when the shared queue cap rises, so backed-up runners drain now. */
  'task:queue-cap-changed': void;
}
