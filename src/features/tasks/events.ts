import type { TaskLedgerEntry, TaskStatus } from './model/taskTypes';

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
  /** Emitted when the agent emits a <claudian_progress> block. */
  'task:progress': { taskId: string; path: string; step: string; done?: { complete: number; total: number } };
  /** Emitted when the run pauses for user input. */
  'task:needs-input': { taskId: string; path: string; question: string; why?: string; default?: string; runId: string };
  /** Emitted when the run pauses for user approval. */
  'task:needs-approval': { taskId: string; path: string; action: string; risk?: string; reversible?: boolean; runId: string };
  /** Emitted when the run resumes after a pause. */
  'task:resumed': { taskId: string; path: string };
  /** Emitted when a run ends without a parseable handoff but with content. */
  'task:needs-handoff': { taskId: string; path: string; error: string };
  /** Emitted when the parser drops a malformed claudian_* block. */
  'task:parser-warning': { taskId: string; path: string; warning: string };
  /** Emitted when LedgerWriter has given up flushing after retries. */
  'task:ledger-flush-degraded': { taskId: string; path: string };
}
