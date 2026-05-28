import type ClaudianPlugin from '../../../main';
import type { TaskSpec } from '../model/taskTypes';
import type { TaskExecutionSurface, TaskRunHandle, TaskRunOptions } from './TaskExecutionSurface';

export class ChatTabExecutionSurface implements TaskExecutionSurface {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async startTaskRun(_task: TaskSpec, _options: TaskRunOptions): Promise<TaskRunHandle> {
    void this.plugin;
    return {
      status: 'failed',
      runId: '',
      conversationId: null,
      sidepanelTabId: null,
      finalAssistantContent: '',
      error: 'ChatTabExecutionSurface is not connected to chat yet',
    };
  }
}
