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

    // Only open the chat view if it isn't already present; activating an
    // existing view would steal focus from wherever the user currently is.
    let view = this.plugin.getView();
    if (!view) {
      await this.plugin.activateView();
      view = this.plugin.getView();
    }
    if (!view) return this.failed('Could not open the Claudian chat view.');

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await view.startTaskRunInFreshTab({
      providerId: provider as ProviderId,
      model,
      prompt: options.prompt,
      tabReservation: options.tabReservation,
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

  async requestCommitTurn(task: TaskSpec, prompt: string): Promise<void> {
    const { provider, model } = task.frontmatter;
    if (!provider) throw new Error('Work order is missing provider');
    if (!model) throw new Error('Work order is missing model');

    let view = this.plugin.getView();
    if (!view) {
      await this.plugin.activateView();
      view = this.plugin.getView();
    }
    if (!view) throw new Error('Could not open the Claudian chat view.');

    await view.injectCommitTurnForConversation({
      conversationId: task.frontmatter.conversation_id ?? null,
      fallbackProviderId: provider as ProviderId,
      fallbackModel: model,
      prompt,
    });
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
