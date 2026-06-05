import type { TaskSpec } from '../model/taskTypes';
import type { ProviderStreamAdapter } from './ProviderStreamAdapter';

export interface TaskRunOptions {
  prompt: string;
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
