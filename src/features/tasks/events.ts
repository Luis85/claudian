import type { TaskStatus } from './model/taskTypes';

export interface TaskEventMap {
  /** Emitted when Agent Board configuration (lanes/folder) changes. */
  'task:board-config-changed': void;
  /** Emitted when a work-order run begins. */
  'task:run-started': { taskId: string; path: string };
  /** Emitted whenever a work order's status is written. */
  'task:status-changed': { taskId: string; path: string; status: TaskStatus };
  /** Emitted when a work-order run ends. */
  'task:run-finished': { taskId: string; path: string; status: TaskStatus };
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
