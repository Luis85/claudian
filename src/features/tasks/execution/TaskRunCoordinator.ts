import type { ChatTabReservation, ChatTabReservations } from '../../../core/chatTabReservations';
import type { TaskEventEmitter } from '../events';
import type { TaskLedgerEntry, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';
import type { RunSidecarHeartbeat } from '../storage/RunSidecarStore';
import { ActiveRunRegistry } from './activeRunRegistry';
import { RunSession, type RunSessionResult, type RunSessionWriteStatusOptions } from './RunSession';
import type { TaskExecutionSurface } from './TaskExecutionSurface';

export interface TaskRunCoordinatorDeps {
  executionSurface: TaskExecutionSurface;
  events: TaskEventEmitter;
  now: () => string;
  isProviderEnabled: (providerId: string) => boolean;
  ownsModel: (providerId: string, model: string) => boolean;
  writeTaskStatus: (task: TaskSpec, options: RunSessionWriteStatusOptions) => Promise<void>;
  /**
   * Sidecar heartbeat write — keyed by runId only, not by note. Replaces the
   * per-tick frontmatter heartbeat that raced the agent's checklist Edits on
   * the same note. The sidecar is run-scoped so a stale heartbeat from a
   * previous run can't leak across.
   */
  writeHeartbeat: (runId: string, heartbeat: RunSidecarHeartbeat) => Promise<void>;
  /**
   * Sidecar ledger append (one entry per call). Receives the task for
   * sidecar-path resolution and the runId so the sidecar stays partitioned by
   * run. The note's ledger region is updated only at terminal via
   * {@link finalizeLedgerToNote}.
   */
  appendLedger: (task: TaskSpec, runId: string, entry: TaskLedgerEntry) => Promise<void>;
  /**
   * Snapshots the sidecar ledger into the work-order note's
   * `<!-- claudian:run-ledger-* -->` region. Called once on every terminal
   * path (completed, failed, canceled, needs_handoff) after the terminal
   * status write and (when present) the handoff write.
   */
  finalizeLedgerToNote: (task: TaskSpec, runId: string) => Promise<void>;
  writeHandoff: (task: TaskSpec, markdown: string) => Promise<void>;
  renderPrompt?: (task: TaskSpec) => string;
  heartbeatIntervalMs?: number;
  staleThresholdMs?: number;
  /**
   * Process-shared registry of live runs. Reserved before the surface resolves
   * and held for the whole run, so concurrent/cross-view runs of the same work
   * order are rejected, crash recovery can tell a run is still live, and the live
   * session is reachable for reply/approve/reject/stop. Defaults to a
   * coordinator-local registry when omitted.
   */
  runRegistry?: ActiveRunRegistry;
  /**
   * Optional shared in-flight set so coordinators in different Agent Board panes
   * observe the same active runs and never double-launch a card. The queue
   * runner's eligibility predicate reads it via {@link TaskRunCoordinator.isActive}.
   * Kept in lockstep with the registry across both run paths.
   */
  activeRuns?: Set<string>;
  /**
   * Optional shared chat-tab reservation ledger. A run reserves a tab slot at
   * launch so concurrent panes don't double-book the same free tabs; the surface
   * releases it once the tab is created.
   */
  reservations?: ChatTabReservations;
}

export type TaskRunResult =
  | { ok: true; status: TaskStatus }
  | { ok: false; error: string; canceled?: boolean; startupFailed?: boolean };

/**
 * Wires a work order to a chat-tab run and delegates the per-run lifecycle to a
 * {@link RunSession}. The coordinator owns validation and the active-run registry;
 * RunSession owns status writes, the live ledger, heartbeat, and pause/resume.
 */
export class TaskRunCoordinator {
  // Shared (when injected) registry of live runs: powers the concurrency guard,
  // crash recovery, and reply/approve/reject/stop routing across views.
  private readonly registry: ActiveRunRegistry;
  // Lightweight in-flight id set, shared across panes for the queue runner's
  // eligibility check; kept in lockstep with the registry in run().
  private readonly activeRuns: Set<string>;

  constructor(private readonly deps: TaskRunCoordinatorDeps) {
    this.registry = deps.runRegistry ?? new ActiveRunRegistry();
    this.activeRuns = deps.activeRuns ?? new Set<string>();
  }

  /** The live session for a task, if one is currently running (drives reply/approve/reject). */
  getActiveRun(taskId: string): RunSession | undefined {
    return this.registry.getSession(taskId);
  }

  /** Whether a run for `taskId` is currently in flight. Used by the queue
   * runner's eligibility predicate to skip cards already running (manual or
   * auto), keeping a single in-flight view across both run paths. */
  isActive(taskId: string): boolean {
    return this.activeRuns.has(taskId) || this.registry.has(taskId);
  }

  async run(task: TaskSpec, externalReservation?: ChatTabReservation): Promise<TaskRunResult> {
    const { provider, model, id } = task.frontmatter;

    if (!provider) return { ok: false, error: 'Work order is missing provider' };
    if (!model) return { ok: false, error: 'Work order is missing model' };
    if (task.frontmatter.status === 'running' || this.registry.has(id) || this.activeRuns.has(id)) {
      return { ok: false, error: 'This work order is already running.' };
    }
    if (!this.deps.isProviderEnabled(provider)) {
      return { ok: false, error: `Provider ${provider} is not enabled` };
    }
    if (!this.deps.ownsModel(provider, model)) {
      return { ok: false, error: `Model ${model} is not available for provider ${provider}` };
    }

    // Reserve the id in both the live-session registry (which holds the RunSession
    // for reply/stop) and the cross-pane in-flight set before awaiting the surface
    // (tab creation), so a concurrent run of the same work order is rejected.
    this.registry.reserve(id);
    this.activeRuns.add(id);
    // Use the queue runner's reservation when it made one synchronously at launch
    // (so other panes saw it before this run's async reload); otherwise reserve
    // here for the manual-run path. The surface releases it the moment the tab is
    // created; the finally below is the safety net for paths that never open one.
    const reservation = externalReservation ?? this.deps.reservations?.reserve();
    try {
      const prompt = (this.deps.renderPrompt ?? renderTaskPrompt)(task);
      // Thread the roster agent id through to the surface so the run's
      // conversation is bound from creation. Non-roster / absent agent values
      // are left as undefined (the existing persona field has no effect here).
      const boundAgentId = task.frontmatter.agent?.startsWith('roster:')
        ? task.frontmatter.agent
        : undefined;
      const handle = await this.deps.executionSurface.startTaskRun(task, {
        prompt,
        tabReservation: reservation,
        boundAgentId,
      });
      if (!handle.runId) {
        const terminal = await handle.terminal;
        // The surface couldn't open a chat tab/view (environmental, e.g. tab cap
        // or the view not ready) — not a card failure. Flag it so the queue
        // records a stable skip and waits for capacity instead of hot-retrying
        // the still-ready card and tripping its auto-halt streak.
        return { ok: false, error: terminal.error ?? 'Run failed.', startupFailed: true };
      }

      const session = new RunSession({
        task,
        runId: handle.runId,
        // The conversation is created lazily by the first chat turn, so read it
        // live: it is null at start and becomes non-null once the send binds it.
        getConversationId: () => handle.conversationId,
        sidepanelTabId: handle.sidepanelTabId,
        stream: handle.stream,
        events: this.deps.events,
        now: this.deps.now,
        writeStatus: this.deps.writeTaskStatus,
        writeHeartbeat: this.deps.writeHeartbeat,
        // `task` is captured: `appendLedger` injects it for sidecar path resolution.
        appendLedger: (runId, entry) => this.deps.appendLedger(task, runId, entry),
        finalizeLedgerToNote: this.deps.finalizeLedgerToNote,
        writeHandoff: this.deps.writeHandoff,
        heartbeatIntervalMs: this.deps.heartbeatIntervalMs,
        staleThresholdMs: this.deps.staleThresholdMs,
      });
      this.registry.bind(id, session);
      // Drive the session to a prompt finish if the chat turn settles but emits
      // no stream end, so it doesn't wait for onEnd until the stale timer. This
      // covers failure/cancel (e.g. provider init failed) and the `completed`
      // case where the controller resolved ok without a `done` chunk (e.g. the
      // provider threw after creating the assistant message). Never block on the
      // terminal: these calls are no-ops once the session is finishing (the
      // normal stream `done` fires before the terminal resolves, so it wins) or
      // after a stale-heartbeat settle.
      void handle.terminal
        .then((terminal) => {
          if (terminal.status === 'failed') session.fail(terminal.error ?? 'Chat run failed.');
          else if (terminal.status === 'canceled') session.cancel('Chat run canceled.');
          else session.complete(terminal.finalAssistantContent);
        })
        .catch((error) => session.fail(error instanceof Error ? error.message : String(error)));
      const result: RunSessionResult = await session.run();
      if (result.ok) return { ok: true, status: result.status };
      // Report cancellation distinctly (only when true, so the common failure
      // shape stays `{ ok, error }`) so the queue runner doesn't count a
      // user-initiated stop as a provider failure toward its auto-halt streak.
      if (result.status === 'canceled') return { ok: false, error: result.error, canceled: true };
      return { ok: false, error: result.error };
    } finally {
      // Idempotent with the surface's release at tab creation; covers early
      // failures (provider/guard errors) that never reach the surface.
      reservation?.release();
      this.registry.release(id);
      this.activeRuns.delete(id);
    }
  }
}
