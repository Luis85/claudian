import type { TaskLedgerEntry, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';
import type { TaskExecutionSurface } from './TaskExecutionSurface';
import { parseTaskHandoff } from './TaskHandoffParser';

export interface WriteTaskStatusOptions {
  status: TaskStatus;
  runId?: string | null;
  conversationId?: string | null;
  sidepanelTabId?: string | null;
  timestamp: string;
}

export interface TaskRunCoordinatorDeps {
  executionSurface: TaskExecutionSurface;
  now: () => string;
  isProviderEnabled: (providerId: string) => boolean;
  ownsModel: (providerId: string, model: string) => boolean;
  writeTaskStatus: (task: TaskSpec, options: WriteTaskStatusOptions) => Promise<void>;
  appendLedger: (task: TaskSpec, entry: TaskLedgerEntry) => Promise<void>;
  writeHandoff: (task: TaskSpec, markdown: string) => Promise<void>;
}

export type TaskRunResult =
  | { ok: true; status: TaskStatus }
  | { ok: false; error: string };

export class TaskRunCoordinator {
  private readonly activeRuns = new Set<string>();

  constructor(private readonly deps: TaskRunCoordinatorDeps) {}

  async run(task: TaskSpec): Promise<TaskRunResult> {
    const { provider, model, id } = task.frontmatter;

    if (!provider) return { ok: false, error: 'Work order is missing provider' };
    if (!model) return { ok: false, error: 'Work order is missing model' };

    if (task.frontmatter.status === 'running' || this.activeRuns.has(id)) {
      return { ok: false, error: 'This work order is already running.' };
    }

    if (!this.deps.isProviderEnabled(provider)) {
      return { ok: false, error: `Provider ${provider} is not enabled` };
    }
    if (!this.deps.ownsModel(provider, model)) {
      return { ok: false, error: `Model ${model} is not available for provider ${provider}` };
    }

    this.activeRuns.add(id);
    try {
      const startedAt = this.deps.now();
      await this.deps.writeTaskStatus(task, { status: 'running', timestamp: startedAt });
      await this.deps.appendLedger(task, {
        timestamp: startedAt,
        status: 'running',
        message: 'Run started.',
      });

      const prompt = renderTaskPrompt(task);
      const handle = await this.deps.executionSurface.startTaskRun(task, { prompt });

      const finishedAt = this.deps.now();
      const runFields = {
        runId: handle.runId,
        conversationId: handle.conversationId,
        sidepanelTabId: handle.sidepanelTabId,
        timestamp: finishedAt,
      };

      if (handle.status === 'canceled') {
        await this.deps.writeTaskStatus(task, { status: 'canceled', ...runFields });
        await this.deps.appendLedger(task, {
          timestamp: finishedAt,
          status: 'canceled',
          message: 'Run canceled.',
        });
        return { ok: false, error: 'Run canceled.' };
      }

      if (handle.status === 'failed') {
        const error = handle.error ?? 'Run failed.';
        await this.deps.writeTaskStatus(task, { status: 'failed', ...runFields });
        await this.deps.appendLedger(task, {
          timestamp: finishedAt,
          status: 'failed',
          message: error,
        });
        return { ok: false, error };
      }

      const parsed = parseTaskHandoff(handle.finalAssistantContent);
      if (!parsed.ok) {
        await this.deps.writeTaskStatus(task, { status: 'failed', ...runFields });
        await this.deps.appendLedger(task, {
          timestamp: finishedAt,
          status: 'failed',
          message: parsed.error,
        });
        return { ok: false, error: parsed.error };
      }

      await this.deps.writeHandoff(task, parsed.handoff.markdown);
      await this.deps.writeTaskStatus(task, { status: 'review', ...runFields });
      await this.deps.appendLedger(task, {
        timestamp: finishedAt,
        status: 'review',
        message: 'Handoff written.',
      });
      return { ok: true, status: 'review' };
    } finally {
      this.activeRuns.delete(id);
    }
  }
}
