import type { TaskEventEmitter } from '../events';
import type { TaskLedgerEntry, TaskSpec, TaskStatus } from '../model/taskTypes';
import type { RunSidecarHeartbeat } from '../storage/RunSidecarStore';
import { LedgerWriter } from './LedgerWriter';
import type { ProviderStreamAdapter } from './ProviderStreamAdapter';
import { type SpecoratorBlock,SpecoratorBlockParser } from './SpecoratorBlockParser';
import { parseTaskHandoff } from './TaskHandoffParser';

/**
 * Shared stale-heartbeat threshold. After this much wall time with no sidecar
 * heartbeat tick the run is treated as dead — both by the session's own stale
 * cancel and by the board's orphan recovery. Keeping a single export means the
 * UI's "is this card still alive?" check stays aligned with the session's own
 * notion of "is my own heartbeat still fresh?".
 */
export const DEFAULT_STALE_THRESHOLD_MS = 5 * 60_000;

export interface RunSessionWriteStatusOptions {
  status: TaskStatus;
  timestamp: string;
  runId?: string | null;
  conversationId?: string | null;
  sidepanelTabId?: string | null;
  started?: string | null;
  heartbeat?: string | null;
  pauseReason?: string | null;
  attempts?: number;
}

export interface RunSessionDeps {
  task: TaskSpec;
  runId: string;
  /**
   * Reads the run's conversation id live. The conversation is created lazily by
   * the first chat turn, so this is null at run start and becomes non-null once
   * bound; status writes pick it up then (and never clear an existing binding).
   */
  getConversationId: () => string | null;
  sidepanelTabId: string | null;
  stream: ProviderStreamAdapter;
  events: TaskEventEmitter;
  now: () => string;
  writeStatus: (task: TaskSpec, options: RunSessionWriteStatusOptions) => Promise<void>;
  /**
   * Sidecar heartbeat write. Replaces the per-tick frontmatter heartbeat that
   * raced the agent's checklist Edits. Receives the run id so the coordinator
   * can stamp the heartbeat into a sidecar keyed off the run, not the note.
   */
  writeHeartbeat: (runId: string, heartbeat: RunSidecarHeartbeat) => Promise<void>;
  /**
   * Sidecar ledger append (one entry per call). The note is updated only at
   * terminal via {@link finalizeLedgerToNote}.
   */
  appendLedger: (runId: string, entry: TaskLedgerEntry) => Promise<void>;
  /**
   * Snapshots the sidecar ledger into the work-order note's
   * `<!-- specorator:run-ledger-* -->` region. Called once on every terminal
   * path (completed, failed, canceled, needs_handoff) after the terminal
   * status write and (when present) the handoff write.
   */
  finalizeLedgerToNote: (task: TaskSpec, runId: string) => Promise<void>;
  writeHandoff: (task: TaskSpec, markdown: string) => Promise<void>;
  heartbeatIntervalMs?: number;
  staleThresholdMs?: number;
  ledgerIntervalMs?: number;
  ledgerMilestone?: number;
}

export type RunSessionResult =
  | { ok: true; status: TaskStatus }
  | { ok: false; error: string; status: TaskStatus };

export type ResumeArg =
  | { kind: 'reply'; content: string }
  | { kind: 'approve' }
  | { kind: 'reject'; reason: string };

const DEFAULTS = {
  heartbeatIntervalMs: 30_000,
  staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
  ledgerIntervalMs: 5_000,
  ledgerMilestone: 3,
};

/**
 * Owns the lifecycle of a single work-order run: status writes, debounced ledger,
 * heartbeat/stale detection, inline-protocol pause/resume, and the terminal
 * handoff transition. The live wiring (stream subscription, heartbeat, the first
 * ledger line) is established synchronously in {@link run} so no stream event or
 * timer tick is missed while the initial status write is in flight.
 */
export class RunSession {
  private readonly parser = new SpecoratorBlockParser();
  private readonly ledger: LedgerWriter;
  private lastEvent = Date.now();
  private heartbeatTimer: number | null = null;
  private staleTimer: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private resolveTerminal: ((r: RunSessionResult) => void) | null = null;
  private readonly terminalPromise: Promise<RunSessionResult>;
  private paused = false;
  // Sticky: true once the run has paused at least once. After a pause the initial
  // chat terminal no longer represents the run's true end (follow-up turns run
  // with their own unwired terminals), so the terminal-completed fallback must
  // not finalize from it.
  private hasPaused = false;
  private pauseApplied: Promise<void> = Promise.resolve();
  // Number of pause turns whose own `done` we still expect to ignore. Each pause
  // ends the agent's turn (so the stream emits a `done`); we must not let that
  // turn-end finalize the run, even if the user resumes before it arrives.
  private pauseEndsPending = 0;
  // Fire-and-forget status writes (initial `running`, heartbeats). finish() awaits
  // these before the terminal write so a slow start/heartbeat write can't land
  // afterward and revert a completed run back to running.
  private readonly pendingStatusWrites = new Set<Promise<void>>();
  private finalContentBuffer = '';
  private attemptNumber = 0;
  private finishing = false;
  // Tools can run for minutes with no intervening stream chunks (a long build or
  // test). Track in-flight tools so the stale check doesn't mistake a working
  // tool for a dead stream and cancel the turn.
  private inFlightTools = 0;

  constructor(private readonly deps: RunSessionDeps) {
    this.ledger = new LedgerWriter({
      // Append each batched entry to the sidecar (per-entry append), then emit
      // the per-entry event. Batching stays at the writer to avoid one syscall
      // per progress line; the writer's order is preserved here by `for...of`.
      flush: async (entries) => {
        for (const entry of entries) {
          await this.deps.appendLedger(this.deps.runId, entry);
          this.deps.events.emit('task:ledger-appended', { taskId: this.taskId, path: this.path, entry });
        }
      },
      intervalMs: deps.ledgerIntervalMs ?? DEFAULTS.ledgerIntervalMs,
      milestoneThreshold: deps.ledgerMilestone ?? DEFAULTS.ledgerMilestone,
      onDegraded: () => {
        this.deps.events.emit('task:ledger-flush-degraded', { taskId: this.taskId, path: this.path });
      },
    });
    this.terminalPromise = new Promise((resolve) => { this.resolveTerminal = resolve; });
  }

  private get taskId(): string { return this.deps.task.frontmatter.id; }
  private get path(): string { return this.deps.task.path; }

  /** Tracks a fire-and-forget status write so finish() can await it before the terminal write. */
  private trackBackgroundWrite(write: Promise<void>): void {
    const settled = write.catch(() => undefined);
    this.pendingStatusWrites.add(settled);
    void settled.finally(() => this.pendingStatusWrites.delete(settled));
  }

  /**
   * Writes a status, attaching the live conversation id when one is bound. Never
   * passes a null id, so the lazily-created conversation persists as soon as it
   * exists without clearing an existing binding on a re-run.
   */
  private persistStatus(options: RunSessionWriteStatusOptions): Promise<void> {
    const conversationId = this.deps.getConversationId();
    const merged = conversationId ? { conversationId, ...options } : options;
    return this.deps.writeStatus(this.deps.task, merged);
  }

  run(): Promise<RunSessionResult> {
    this.attemptNumber = (this.deps.task.frontmatter.attempts ?? 0) + 1;
    const ts = this.deps.now();
    this.ledger.enqueue({ timestamp: ts, status: 'running', message: `Run started (attempt ${this.attemptNumber})` });
    this.deps.events.emit('task:attempt-started', { taskId: this.taskId, path: this.path, attemptNumber: this.attemptNumber });
    this.startHeartbeat();
    this.trackBackgroundWrite(this.persistStatus({
      status: 'running',
      timestamp: ts,
      runId: this.deps.runId,
      sidepanelTabId: this.deps.sidepanelTabId,
      // Stamp the run-start once; heartbeats deliberately omit `started`.
      started: ts,
      heartbeat: ts,
      attempts: this.attemptNumber,
    }));
    // Subscribe last: a fast/local run can have buffered chunks that the chat
    // handle replays synchronously inside subscribe(), finishing the run before
    // subscribe() returns. In that window this.unsubscribe is unassigned, so
    // finish()'s stopLiveWiring() can't detach the observer (and it cleared the
    // heartbeat started above). Reconcile here: if the run already finished,
    // detach the now-known observer; otherwise store it for later teardown.
    const unsubscribe = this.deps.stream.subscribe({
      onText: (chunk) => this.handleText(chunk),
      onToolUse: (tool) => this.handleTool(tool.name, tool.primaryArg),
      onToolResult: () => this.handleToolResult(),
      onError: (error) => this.handleError(error),
      onActivity: () => this.touch(),
      onEnd: (payload) => { void this.finish(payload); },
    });
    if (this.finishing) unsubscribe();
    else this.unsubscribe = unsubscribe;
    return this.terminalPromise;
  }

  async resume(arg: ResumeArg): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    // Wait for the pause status (and its ledger flush) to land before acting so
    // the persisted status order stays consistent under racing resume calls.
    await this.pauseApplied;

    if (arg.kind === 'reject') {
      // Route through finish() so the terminal write waits for the in-flight
      // running/heartbeat writes (a fast reject must not be overtaken by a late
      // initial running write that re-activates the work order).
      this.ledger.enqueue({ timestamp: this.deps.now(), status: 'canceled', message: `rejected: ${arg.reason}` });
      this.deps.stream.cancel();
      await this.finish({
        status: 'canceled',
        finalAssistantContent: this.finalContentBuffer,
        error: `rejected: ${arg.reason}`,
      });
      return;
    }

    const content = arg.kind === 'reply' ? arg.content : 'approved';
    const ts = this.deps.now();
    try {
      await this.persistStatus({ status: 'running', timestamp: ts, heartbeat: ts, pauseReason: null });
    } catch (error) {
      // The frontmatter write failed (vault offline / file gone / hand-edited
      // markers). The UI would otherwise see no event at all and the card
      // would sit at needs_input forever with no live driver — fail the run
      // visibly instead so the board's status-changed handler surfaces it.
      // Do NOT emit `task:resumed` first: the board reads that as "back to
      // running" and drops the reply surface before the failure lands.
      const message = error instanceof Error ? error.message : String(error);
      this.ledger.enqueue({ timestamp: ts, status: 'failed', message: `resume failed: ${message}` });
      this.deps.stream.cancel();
      await this.finish({
        status: 'failed',
        finalAssistantContent: this.finalContentBuffer,
        error: `resume failed: ${message}`,
      });
      return;
    }
    this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: 'running' });
    this.deps.events.emit('task:resumed', { taskId: this.taskId, path: this.path });
    this.ledger.enqueue({ timestamp: ts, status: 'running', message: `resumed: ${truncate(content, 80)}` });
    this.startHeartbeat();
    // Fire the follow-up and wire its settlement, mirroring how the coordinator
    // wires the initial turn's terminal: a follow-up that ends without a stream
    // `done` still finishes the run. Don't await it (resume returns once the turn
    // is dispatched). The completion reads paused/finishing at settlement, so it
    // is turn-isolated — a late `done` from the pause turn can't drive it.
    void Promise.resolve(this.deps.stream.sendFollowUp(content))
      .then((outcome) => {
        if (!outcome) return; // adapter reports no outcome; stream chunks drive finish
        if (outcome.ok) this.completeFromFollowUp(outcome.finalAssistantContent);
        else this.fail(outcome.error);
      })
      .catch((error) => this.fail(error instanceof Error ? error.message : String(error)));
  }

  /**
   * Finish from a follow-up turn that settled `ok`. Finalizes only when no
   * stream `done` already did (finishing) and the follow-up did not itself pause
   * again (paused). Reading state at settlement keeps it turn-isolated.
   */
  private completeFromFollowUp(content: string): void {
    if (this.finishing || this.paused) return;
    // Use the follow-up turn's own result, not the accumulated multi-turn buffer:
    // finalContentBuffer still holds the earlier pause turn, so a length compare
    // could discard a valid (shorter) follow-up handoff for stale pause text.
    void this.finish({ status: 'completed', finalAssistantContent: content });
  }

  cancel(reason = 'stopped by user'): void {
    if (this.finishing) return;
    const ts = this.deps.now();
    this.ledger.enqueue({ timestamp: ts, status: 'canceled', message: reason });
    this.deps.stream.cancel();
    void this.finish({ status: 'canceled', finalAssistantContent: this.finalContentBuffer });
  }

  /**
   * Fail the run from outside the stream (e.g. the chat turn settled with an
   * error but emitted no stream end, so onEnd never fired). No-op once finishing.
   */
  fail(error: string): void {
    if (this.finishing) return;
    void this.finish({ status: 'failed', finalAssistantContent: this.finalContentBuffer, error });
  }

  /**
   * Complete the run from outside the stream: the chat turn settled `completed`
   * but emitted no stream `done` (e.g. the provider threw after creating the
   * assistant message yet the controller still resolved ok). No-op once finishing
   * — the normal stream `done` fires before the terminal resolves, so it wins —
   * and no-op once the run has paused, since the initial terminal then no longer
   * marks the run's end. Prefers the live stream content when richer than the
   * terminal's snapshot.
   */
  complete(finalAssistantContent: string): void {
    if (this.finishing || this.hasPaused) return;
    const content = finalAssistantContent.length >= this.finalContentBuffer.length
      ? finalAssistantContent
      : this.finalContentBuffer;
    void this.finish({ status: 'completed', finalAssistantContent: content });
  }

  private handleText(chunk: string): void {
    this.touch();
    this.finalContentBuffer += chunk;
    const out = this.parser.feed(chunk);
    for (const warning of out.warnings) {
      this.deps.events.emit('task:parser-warning', { taskId: this.taskId, path: this.path, warning });
      this.ledger.enqueue({ timestamp: this.deps.now(), status: 'running', message: `(parser) ${warning}` });
    }
    for (const block of out.blocks) {
      if (this.paused) {
        this.deps.events.emit('task:parser-warning', {
          taskId: this.taskId,
          path: this.path,
          warning: `ignored second pause block while already paused: ${block.kind}`,
        });
        continue;
      }
      if (block.kind === 'progress') this.handleProgress(block);
      else if (block.kind === 'needs_input') this.beginPause('needs_input', block);
      else if (block.kind === 'needs_approval') this.beginPause('needs_approval', block);
    }
  }

  private handleProgress(block: SpecoratorBlock): void {
    const step = block.fields.step ?? '';
    const doneStr = block.fields.done;
    let done: { complete: number; total: number } | undefined;
    if (doneStr) {
      const match = doneStr.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (match) done = { complete: parseInt(match[1], 10), total: parseInt(match[2], 10) };
    }
    this.ledger.enqueue({ timestamp: this.deps.now(), status: 'running', message: `progress: ${truncate(step, 120)}` });
    this.deps.events.emit('task:progress', { taskId: this.taskId, path: this.path, step, done });
  }

  private beginPause(kind: 'needs_input' | 'needs_approval', block: SpecoratorBlock): void {
    this.paused = true;
    this.hasPaused = true;
    this.pauseEndsPending += 1;
    this.stopHeartbeat();
    const reason = kind === 'needs_input' ? block.fields.question : block.fields.action;
    // Initiate the status write synchronously (so the persisted status order is
    // deterministic) and expose its completion as a barrier for resume/cancel.
    this.pauseApplied = this.applyPause(kind, block, reason ?? null);
  }

  private async applyPause(
    kind: 'needs_input' | 'needs_approval',
    block: SpecoratorBlock,
    reason: string | null,
  ): Promise<void> {
    const ts = this.deps.now();
    try {
      await this.persistStatus({ status: kind, timestamp: ts, pauseReason: reason });
    } catch (error) {
      // The pause status couldn't be persisted, so the board can't surface the
      // pause and the run would hang paused with no live UI. Clear the pause and
      // fail the run so it settles and the shared registry releases it, rather
      // than stranding it until a reload. finish() awaits this same pauseApplied
      // promise, which resolves as this catch returns — no self-deadlock.
      this.paused = false;
      this.fail(error instanceof Error ? error.message : String(error));
      return;
    }
    this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: kind });
    if (kind === 'needs_input') {
      this.deps.events.emit('task:needs-input', {
        taskId: this.taskId,
        path: this.path,
        question: block.fields.question,
        why: block.fields.why,
        default: block.fields.default,
        runId: this.deps.runId,
      });
    } else {
      this.deps.events.emit('task:needs-approval', {
        taskId: this.taskId,
        path: this.path,
        action: block.fields.action,
        risk: block.fields.risk,
        reversible: block.fields.reversible === 'true' ? true : block.fields.reversible === 'false' ? false : undefined,
        runId: this.deps.runId,
      });
    }
    await this.ledger.flushNow();
  }

  private handleTool(name: string, primaryArg: string | null): void {
    this.inFlightTools += 1;
    this.touch();
    const arg = primaryArg ? ` ${truncate(primaryArg, 60)}` : '';
    this.ledger.enqueue({ timestamp: this.deps.now(), status: 'running', message: `tool: ${name}${arg}` });
  }

  private handleToolResult(): void {
    if (this.inFlightTools > 0) this.inFlightTools -= 1;
    this.touch();
  }

  private handleError(error: string): void {
    void this.finish({ status: 'failed', finalAssistantContent: this.finalContentBuffer, error });
  }

  private async finish(payload: {
    status: 'completed' | 'failed' | 'canceled';
    finalAssistantContent: string;
    error?: string;
  }): Promise<void> {
    if (this.resolveTerminal === null || this.finishing) return;
    // Each pause ends the agent's turn, so its own `done` arrives as a completed
    // turn-end. Ignore exactly one such end per pause — even if the user already
    // resumed (the late pause-turn `done` must not finalize the follow-up run).
    // Real failures and cancels always finalize.
    if (payload.status === 'completed' && this.pauseEndsPending > 0) {
      this.pauseEndsPending -= 1;
      return;
    }
    // Implicit pause: a completed turn that produced text but no structured
    // handoff/pause block is the assistant pausing for clarification. Persist
    // as needs_input and keep the stream wired so a follow-up turn can settle
    // the run — instead of marking the work order needs_handoff and stranding
    // any later `<specorator_needs_input>` block the assistant emits.
    if (payload.status === 'completed' && !this.paused
        && payload.finalAssistantContent.trim().length > 0
        && !parseTaskHandoff(payload.finalAssistantContent).ok) {
      await this.pauseApplied;
      this.beginImplicitPause(payload.finalAssistantContent);
      await this.pauseApplied;
      return;
    }
    this.finishing = true;
    this.stopLiveWiring();
    try {
      await this.finalizeRun(payload);
    } catch (error) {
      // A terminal note write failed (e.g. a hand-edited note missing generated
      // markers). Settle as failed so the run doesn't hang and the shared
      // registry releases the task.
      await this.settleAfterFailure(error);
    }
  }

  private beginImplicitPause(content: string): void {
    this.paused = true;
    this.hasPaused = true;
    this.stopHeartbeat();
    const reason = extractImplicitPauseReason(content);
    this.pauseApplied = this.applyImplicitPause(reason);
  }

  private async applyImplicitPause(reason: string): Promise<void> {
    const ts = this.deps.now();
    try {
      await this.persistStatus({ status: 'needs_input', timestamp: ts, pauseReason: reason });
    } catch (error) {
      // The pause status couldn't be persisted; mirror applyPause and fail
      // rather than hanging the run with no live UI.
      this.paused = false;
      this.fail(error instanceof Error ? error.message : String(error));
      return;
    }
    this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: 'needs_input' });
    this.deps.events.emit('task:needs-input', {
      taskId: this.taskId,
      path: this.path,
      question: reason,
      runId: this.deps.runId,
    });
    this.ledger.enqueue({
      timestamp: ts,
      status: 'needs_input',
      message: `Paused implicitly (no handoff/pause block): ${truncate(reason, 80)}`,
    });
    await this.ledger.flushNow();
  }

  private async finalizeRun(payload: {
    status: 'completed' | 'failed' | 'canceled';
    finalAssistantContent: string;
    error?: string;
  }): Promise<void> {
    // Let every in-flight write settle before the terminal write: the pause
    // write+flush (so the final ledger flush is not skipped by the writer's
    // in-progress guard, e.g. cancel during a pause) and the fire-and-forget
    // running/heartbeat writes (so a slow start write cannot land after the
    // terminal write and revert the run to running).
    await this.pauseApplied;
    if (this.pendingStatusWrites.size > 0) {
      await Promise.all([...this.pendingStatusWrites]);
    }
    const finalOut = this.parser.finalize();
    for (const warning of finalOut.warnings) {
      this.deps.events.emit('task:parser-warning', { taskId: this.taskId, path: this.path, warning });
    }
    const ts = this.deps.now();

    if (payload.status === 'canceled') {
      await this.persistStatus({ status: 'canceled', timestamp: ts });
      this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: 'canceled' });
      await this.writeLedgerSnapshotBestEffort();
      await this.settle({ ok: false, error: payload.error ?? 'canceled', status: 'canceled' });
      return;
    }

    if (payload.status === 'failed') {
      this.ledger.enqueue({ timestamp: ts, status: 'failed', message: payload.error ?? 'Run failed.' });
      await this.persistStatus({ status: 'failed', timestamp: ts });
      this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: 'failed' });
      await this.writeLedgerSnapshotBestEffort();
      await this.settle({ ok: false, error: payload.error ?? 'failed', status: 'failed' });
      return;
    }

    const content = payload.finalAssistantContent;
    const parsed = parseTaskHandoff(content);
    if (parsed.ok) {
      await this.deps.writeHandoff(this.deps.task, parsed.handoff.markdown);
      await this.persistStatus({ status: 'review', timestamp: ts });
      this.ledger.enqueue({ timestamp: ts, status: 'review', message: 'Handoff written.' });
      this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: 'review' });
      await this.writeLedgerSnapshotBestEffort();
      await this.settle({ ok: true, status: 'review' });
      return;
    }

    if (content.length > 0) {
      await this.persistStatus({ status: 'needs_handoff', timestamp: ts });
      this.ledger.enqueue({ timestamp: ts, status: 'needs_handoff', message: parsed.error });
      this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: 'needs_handoff' });
      this.deps.events.emit('task:needs-handoff', { taskId: this.taskId, path: this.path, error: parsed.error });
      await this.writeLedgerSnapshotBestEffort();
      await this.settle({ ok: false, error: parsed.error, status: 'needs_handoff' });
      return;
    }

    await this.persistStatus({ status: 'failed', timestamp: ts });
    this.ledger.enqueue({ timestamp: ts, status: 'failed', message: 'Empty response' });
    this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: 'failed' });
    await this.writeLedgerSnapshotBestEffort();
    await this.settle({ ok: false, error: 'Empty response', status: 'failed' });
  }

  /**
   * Replace the work-order note's run-ledger region with the sidecar snapshot.
   * Best-effort: a failure to flush or snapshot must not hang the run — callers
   * still proceed to `settle()` so the terminal result is resolved. The name
   * stays distinct from the dep `finalizeLedgerToNote` so the call site
   * doesn't read as the session wrapping itself in its own dep.
   */
  private async writeLedgerSnapshotBestEffort(): Promise<void> {
    // Drain the sidecar queue first so the snapshot includes every entry the
    // run produced (the writer batches, so the most recent enqueue may still
    // be pending). Best-effort: a transient flush failure still proceeds to
    // snapshot what's on disk rather than hanging the terminal write.
    try {
      await this.ledger.flushNow();
    } catch {
      // Sidecar append failed; snapshot what's on disk anyway.
    }
    try {
      await this.deps.finalizeLedgerToNote(this.deps.task, this.deps.runId);
    } catch {
      // The note's run-ledger region couldn't be updated (e.g. missing markers).
      // Sidecar still has the full ledger; the run settles cleanly.
    }
  }

  /** Last-resort settle when a terminal write itself fails; marks failed best-effort and never hangs. */
  private async settleAfterFailure(error: unknown): Promise<void> {
    if (this.resolveTerminal === null) return;
    const message = error instanceof Error ? error.message : String(error);
    try {
      await this.persistStatus({ status: 'failed', timestamp: this.deps.now() });
      this.deps.events.emit('task:status-changed', { taskId: this.taskId, path: this.path, status: 'failed' });
    } catch {
      // The note write itself is failing; still settle so the run does not hang.
    }
    this.ledger.enqueue({ timestamp: this.deps.now(), status: 'failed', message: `run finalize failed: ${message}` });
    await this.writeLedgerSnapshotBestEffort();
    await this.settle({ ok: false, error: message, status: 'failed' });
  }

  /** Flushes any remaining ledger lines, disposes the writer, then resolves the terminal exactly once. */
  private async settle(result: RunSessionResult): Promise<void> {
    // finalize() flushes and disposes only once the queue drains, so a transient
    // failure of the terminal flush keeps retrying instead of dropping the lines.
    await this.ledger.finalize();
    const resolve = this.resolveTerminal;
    this.resolveTerminal = null;
    resolve?.(result);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastEvent = Date.now();
    const interval = this.deps.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs;
    const stale = this.deps.staleThresholdMs ?? DEFAULTS.staleThresholdMs;
    this.heartbeatTimer = window.setInterval(() => {
      const at = this.deps.now();
      // Route the heartbeat to a sidecar instead of the note: per-tick frontmatter
      // writes raced the agent's checklist Edits on the same note. The note still
      // sees status writes at transitions (start/pause/resume/terminal), which
      // align with turn boundaries where the agent is not mid-Edit.
      this.trackBackgroundWrite(this.deps.writeHeartbeat(this.deps.runId, { at, status: 'running' }));
      this.deps.events.emit('task:heartbeat', { taskId: this.taskId, path: this.path, at });
    }, interval);
    this.staleTimer = window.setInterval(() => {
      // A tool in flight (e.g. a long build/test) is legitimate work, not a dead
      // stream — don't cancel while one is running. A genuinely hung tool can
      // still be stopped by the user.
      if (this.inFlightTools === 0 && Date.now() - this.lastEvent > stale) {
        // The turn is stuck (no events for the whole window); cancel the provider
        // turn so the chat tab is freed and its terminal promise resolves.
        this.deps.stream.cancel();
        void this.finish({
          status: 'failed',
          finalAssistantContent: this.finalContentBuffer,
          error: `heartbeat lost (no activity for ${formatStaleWindow(stale)})`,
        });
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) { window.clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.staleTimer !== null) { window.clearInterval(this.staleTimer); this.staleTimer = null; }
  }

  private stopLiveWiring(): void {
    this.stopHeartbeat();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private touch(): void {
    this.lastEvent = Date.now();
  }
}

function truncate(value: string, n: number): string {
  if (value.length <= n) return value;
  return value.slice(0, n - 1) + '…';
}

/** Best-effort label for an implicit pause: prefer the last paragraph (typically
 *  the question), capped so a runaway turn can't blow out the pause-reason field. */
function extractImplicitPauseReason(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return 'The agent is waiting for your input.';
  const paragraphs = trimmed.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1].trim();
  const reason = last.length > 0 ? last : trimmed;
  const max = 240;
  if (reason.length <= max) return reason;
  // Tail-truncate (keep the trailing chars — the question usually lands at the
  // end), and signal the cut with a leading "…" so a reader knows context was
  // dropped instead of seeing a fragmentary sentence start.
  return `…${reason.slice(reason.length - (max - 1))}`;
}

function formatStaleWindow(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}
