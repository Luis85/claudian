import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import type { TaskSpec } from '../model/taskTypes';
import { ChatTabStreamAdapter } from './ChatTabStreamAdapter';
import type { ProviderStreamAdapter, StreamHandlers } from './ProviderStreamAdapter';
import type { TaskExecutionSurface, TaskRunHandle, TaskRunOptions, TaskRunTerminal } from './TaskExecutionSurface';

/** Stream adapter for run handles that never started (validation/setup failures). */
class NoopStreamAdapter implements ProviderStreamAdapter {
  subscribe(_handlers: StreamHandlers): () => void {
    return () => {};
  }
  async sendFollowUp(_content: string): Promise<void> {
    /* no-op */
  }
  cancel(): void {
    /* no-op */
  }
}

export class ChatTabExecutionSurface implements TaskExecutionSurface {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async startTaskRun(task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle> {
    // Prefer the coordinator's resolved provider/model (frontmatter, else the
    // assigned roster agent's) over the raw frontmatter.
    const provider = options.provider ?? task.frontmatter.provider;
    const model = options.model ?? task.frontmatter.model;
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
    const handle = await view.startTaskRunInFreshTab({
      providerId: provider as ProviderId,
      model,
      prompt: options.prompt,
      tabReservation: options.tabReservation,
      workOrderPath: task.path,
      boundAgentId: options.boundAgentId,
    });
    if (!handle) {
      return this.failed('Could not open a work-order tab (work-order tab limit reached).');
    }

    return {
      runId,
      // Delegate to the chat handle: the conversation is created lazily by the
      // first send, so this is null now and becomes non-null once bound.
      get conversationId() {
        return handle.conversationId;
      },
      sidepanelTabId: handle.sidepanelTabId,
      stream: new ChatTabStreamAdapter(handle),
      terminal: handle.terminal,
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
    const terminal: TaskRunTerminal = { status: 'failed', finalAssistantContent: '', error };
    return {
      runId: '',
      conversationId: null,
      sidepanelTabId: null,
      stream: new NoopStreamAdapter(),
      terminal: Promise.resolve(terminal),
    };
  }
}
