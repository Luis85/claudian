import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import type { TaskSpec } from '../model/taskTypes';
import type { TaskExecutionSurface, TaskRunHandle, TaskRunOptions } from './TaskExecutionSurface';

export class ChatTabExecutionSurface implements TaskExecutionSurface {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle> {
    const { provider, model } = task.frontmatter;
    if (!provider) return this.failed('Work order is missing provider');
    if (!model) return this.failed('Work order is missing model');

    await this.plugin.activateView();
    const view = this.plugin.getView();
    if (!view) return this.failed('Could not open the Claudian chat view.');

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await view.startTaskRunInFreshTab({
      providerId: provider as ProviderId,
      model,
      prompt: options.prompt,
    });

    return {
      status: result.status,
      runId,
      conversationId: result.conversationId,
      sidepanelTabId: result.sidepanelTabId,
      finalAssistantContent: result.finalAssistantContent,
      error: result.error,
    };
  }

  private failed(error: string): TaskRunHandle {
    return {
      status: 'failed',
      runId: '',
      conversationId: null,
      sidepanelTabId: null,
      finalAssistantContent: '',
      error,
    };
  }
}
