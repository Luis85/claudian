import type { ChatTabReservation, ChatTabReservations } from '../../../core/chatTabReservations';
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
  renderPrompt?: (task: TaskSpec) => string;
  /** Optional shared in-flight set so coordinators in different Agent Board
   * panes observe the same active runs and never double-launch a card. */
  activeRuns?: Set<string>;
  /** Optional shared chat-tab reservation ledger. A run reserves a tab slot at
   * launch so concurrent panes don't double-book the same free tabs; the surface
   * releases it once the tab is created. */
  reservations?: ChatTabReservations;
}

export type TaskRunResult =
  | { ok: true; status: TaskStatus }
  | { ok: false; error: string };

export class TaskRunCoordinator {
  private readonly activeRuns: Set<string>;

  constructor(private readonly deps: TaskRunCoordinatorDeps) {
    this.activeRuns = deps.activeRuns ?? new Set<string>();
  }

  async run(task: TaskSpec, externalReservation?: ChatTabReservation): Promise<TaskRunResult> {
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
    // Use the queue runner's reservation when it made one synchronously at launch
    // (so other panes saw it before this run's async reload); otherwise reserve
    // here for the manual-run path. The surface releases it the moment the tab is
    // created; the finally below is the safety net for paths that never open one.
    const reservation = externalReservation ?? this.deps.reservations?.reserve();
    try {
      const startedAt = this.deps.now();
      await this.deps.writeTaskStatus(task, { status: 'running', timestamp: startedAt });
      await this.deps.appendLedger(task, {
        timestamp: startedAt,
        status: 'running',
        message: 'Run started.',
      });

      const prompt = (this.deps.renderPrompt ?? renderTaskPrompt)(task);
      const handle = await this.deps.executionSurface.startTaskRun(task, {
        prompt,
        tabReservation: reservation,
      });

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
      // Idempotent with the surface's release at tab creation; covers early
      // failures (provider/guard errors) that never reach the surface.
      reservation?.release();
      this.activeRuns.delete(id);
    }
  }

  /** Whether a run for `taskId` is currently in flight. Used by the queue
   * runner's eligibility predicate to skip cards already running (manual or
   * auto), and to keep a single in-flight set across both run paths. */
  isActive(taskId: string): boolean {
    return this.activeRuns.has(taskId);
  }
}
