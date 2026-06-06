import type { ChatTabReservation } from '../../../core/chatTabReservations';
import type { TaskSpec } from '../model/taskTypes';

export interface TaskRunOptions {
  prompt: string;
  /** Reservation for the chat tab this run will open. The surface releases it
   *  once the tab is created so the queue's free-tab gate stops counting it as
   *  pending. Absent for surfaces that don't open a fresh tab. */
  tabReservation?: ChatTabReservation;
}

export interface TaskRunHandle {
  status: 'completed' | 'failed' | 'canceled';
  runId: string;
  conversationId: string | null;
  sidepanelTabId: string | null;
  finalAssistantContent: string;
  error?: string;
}

export interface TaskExecutionSurface {
  startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle>;
  cancelTaskRun?(runId: string): void;
  /**
   * Injects a scoped commit-and-push prompt into the work-order's existing chat
   * conversation. Resolves once the prompt has been queued. Implementations that
   * don't host a chat surface can omit this method.
   */
  requestCommitTurn?(task: TaskSpec, prompt: string): Promise<void>;
}
