import type { TaskSpec } from '../model/taskTypes';

export interface TaskRunOptions {
  prompt: string;
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
}
