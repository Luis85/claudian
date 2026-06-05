import type { TaskEventEmitter } from '../events';
import type { TaskLedgerEntry, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';
import { RunSession, type RunSessionResult, type RunSessionWriteStatusOptions } from './RunSession';
import type { TaskExecutionSurface } from './TaskExecutionSurface';

export interface TaskRunCoordinatorDeps {
  executionSurface: TaskExecutionSurface;
  events: TaskEventEmitter;
  now: () => string;
  isProviderEnabled: (providerId: string) => boolean;
  ownsModel: (providerId: string, model: string) => boolean;
  writeTaskStatus: (task: TaskSpec, options: RunSessionWriteStatusOptions) => Promise<void>;
  flushLedger: (task: TaskSpec, entries: TaskLedgerEntry[]) => Promise<void>;
  writeHandoff: (task: TaskSpec, markdown: string) => Promise<void>;
  renderPrompt?: (task: TaskSpec) => string;
  heartbeatIntervalMs?: number;
  staleThresholdMs?: number;
}

export type TaskRunResult = { ok: true; status: TaskStatus } | { ok: false; error: string };

/**
 * Wires a work order to a chat-tab run and delegates the per-run lifecycle to a
 * {@link RunSession}. The coordinator owns validation and the active-run registry;
 * RunSession owns status writes, the live ledger, heartbeat, and pause/resume.
 */
export class TaskRunCoordinator {
  private readonly activeRuns = new Map<string, RunSession>();
  // Task ids reserved between the guard check and the surface resolving, so two
  // near-simultaneous runs of the same work order can't both open a tab.
  private readonly starting = new Set<string>();

  constructor(private readonly deps: TaskRunCoordinatorDeps) {}

  /** The live session for a task, if one is currently running (drives reply/approve/reject). */
  getActiveRun(taskId: string): RunSession | undefined {
    return this.activeRuns.get(taskId);
  }

  async run(task: TaskSpec): Promise<TaskRunResult> {
    const { provider, model, id } = task.frontmatter;

    if (!provider) return { ok: false, error: 'Work order is missing provider' };
    if (!model) return { ok: false, error: 'Work order is missing model' };
    if (task.frontmatter.status === 'running' || this.activeRuns.has(id) || this.starting.has(id)) {
      return { ok: false, error: 'This work order is already running.' };
    }
    if (!this.deps.isProviderEnabled(provider)) {
      return { ok: false, error: `Provider ${provider} is not enabled` };
    }
    if (!this.deps.ownsModel(provider, model)) {
      return { ok: false, error: `Model ${model} is not available for provider ${provider}` };
    }

    // Reserve the id before awaiting the surface (tab creation), then hold it for
    // the whole run, so a concurrent run of the same work order is rejected.
    this.starting.add(id);
    try {
      const prompt = (this.deps.renderPrompt ?? renderTaskPrompt)(task);
      const handle = await this.deps.executionSurface.startTaskRun(task, { prompt });
      if (!handle.runId) {
        const terminal = await handle.terminal;
        return { ok: false, error: terminal.error ?? 'Run failed.' };
      }

      const session = new RunSession({
        task,
        runId: handle.runId,
        conversationId: handle.conversationId,
        sidepanelTabId: handle.sidepanelTabId,
        stream: handle.stream,
        events: this.deps.events,
        now: this.deps.now,
        writeStatus: this.deps.writeTaskStatus,
        flushLedger: (entries) => this.deps.flushLedger(task, entries),
        writeHandoff: this.deps.writeHandoff,
        heartbeatIntervalMs: this.deps.heartbeatIntervalMs,
        staleThresholdMs: this.deps.staleThresholdMs,
      });
      this.activeRuns.set(id, session);
      try {
        const result: RunSessionResult = await session.run();
        // Do not block on the chat turn's own terminal: when RunSession settles
        // itself (e.g. a stale-heartbeat failure) the provider turn can still be
        // pending, so awaiting here would keep the task in activeRuns and stall the
        // board's finished event/refresh. Just swallow any late rejection.
        void handle.terminal.catch(() => undefined);
        if (result.ok) return { ok: true, status: result.status };
        return { ok: false, error: result.error };
      } finally {
        this.activeRuns.delete(id);
      }
    } finally {
      this.starting.delete(id);
    }
  }
}
