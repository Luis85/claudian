import type { ChatTabReservation } from '../../../core/chatTabReservations';
import type { TaskSpec } from '../model/taskTypes';
import type { ProviderStreamAdapter } from './ProviderStreamAdapter';

export interface TaskRunOptions {
  prompt: string;
  /** Reservation for the chat tab this run will open. The surface releases it
   *  once the tab is created so the queue's free-tab gate stops counting it as
   *  pending. Absent for surfaces that don't open a fresh tab. */
  tabReservation?: ChatTabReservation;
  /**
   * Roster agent id to bind to the run's conversation (e.g. `roster:foo`).
   * Set by `TaskRunCoordinator` when `task.frontmatter.agent` starts with
   * `roster:`. The surface threads it through to `createConversation` so the
   * conversation is bound from the first turn. Undefined for non-roster agents.
   */
  boundAgentId?: string;
}

export interface TaskRunTerminal {
  status: 'completed' | 'failed' | 'canceled';
  finalAssistantContent: string;
  error?: string;
}

export interface TaskRunHandle {
  runId: string;
  conversationId: string | null;
  sidepanelTabId: string | null;
  /** Live stream the run coordinator subscribes to for the work-order ledger. */
  stream: ProviderStreamAdapter;
  /** Resolves when the underlying chat turn settles. */
  terminal: Promise<TaskRunTerminal>;
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
