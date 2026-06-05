import { DEFAULT_LANE_TITLES, type ResolvedBoardLayout, type ResolvedLane } from '../config/boardConfigTypes';
import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import { isRunnableTaskStatus } from '../model/taskStateMachine';
import type { InvalidTaskNote, TaskSpec, TaskStatus } from '../model/taskTypes';

/** Pause payload surfaced on a card while a run waits for input or approval. */
export interface AgentBoardPauseState {
  question?: string;
  action?: string;
  risk?: string;
  defaultValue?: string;
  reversible?: boolean;
  runId?: string;
}

/** Live metrics painted onto a card's strip without rebuilding the card. */
export interface AgentBoardLiveStripPayload {
  lastLedger?: string;
  elapsedMs: number;
  attemptNumber: number;
  heartbeatAgeMs: number;
}

export interface AgentBoardRenderCallbacks {
  onOpenDetail(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onReopen(task: TaskSpec): void;
  onAddWorkOrder(): void;
  onRunNextReady(): void;
  onContextMenu(task: TaskSpec, event: MouseEvent): void;
  onReply?(task: TaskSpec, content: string): void;
  onApprove?(task: TaskSpec): void;
  onReject?(task: TaskSpec, reason: string): void;
  onCancelPaused?(task: TaskSpec): void;
  /** needs_handoff → review: salvage a run that finished without a structured handoff. */
  onSendToReview?(task: TaskSpec): void;
  /** needs_handoff → failed: give up on a run that finished without a structured handoff. */
  onMarkFailed?(task: TaskSpec): void;
}

export interface AgentBoardRenderState {
  layout: ResolvedBoardLayout;
  invalidNotes: InvalidTaskNote[];
  slots: { used: number; max: number };
}

interface CardRefs {
  card: HTMLElement;
  statusBadge: HTMLElement;
  liveStripMeta: HTMLElement | null;
  liveStripLedger: HTMLElement | null;
  actions: HTMLElement;
  reply: HTMLElement | null;
}

const LIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(['running', 'needs_input', 'needs_approval']);

export class AgentBoardRenderer {
  private cardRefs = new Map<string, CardRefs>();
  private callbacks: AgentBoardRenderCallbacks | null = null;

  render(container: HTMLElement, state: AgentBoardRenderState, callbacks: AgentBoardRenderCallbacks): void {
    this.callbacks = callbacks;
    this.cardRefs.clear();
    container.empty();
    const root = container.createDiv({ cls: 'claudian-agent-board' });

    const header = root.createDiv({ cls: 'claudian-agent-board-header' });
    const addButton = header.createEl('button', { cls: 'mod-cta', text: 'Add work order' });
    addButton.addEventListener('click', () => callbacks.onAddWorkOrder());

    const hasRunnable = state.layout.lanes.some((lane) =>
      lane.tasks.some((task) => isRunnableTaskStatus(task.frontmatter.status)),
    );
    if (hasRunnable) {
      const runNextBtn = header.createEl('button', { text: 'Run next ready' });
      runNextBtn.addEventListener('click', () => callbacks.onRunNextReady());
    }

    const free = Math.max(0, state.slots.max - state.slots.used);
    const slotsEl = header.createSpan({
      cls: 'claudian-agent-board-slots',
      text: `Chat tabs ${state.slots.used}/${state.slots.max} · ${free} free`,
    });
    if (free <= 0) {
      slotsEl.addClass('claudian-agent-board-slots--full');
      root.createDiv({
        cls: 'claudian-agent-board-hint',
        text: 'No free chat tabs. A work order run needs a free tab — close a chat tab in the chat panel, or raise "Maximum tabs" in settings.',
      });
    }

    const lanesEl = root.createDiv({ cls: 'claudian-agent-board-lanes' });
    for (const lane of state.layout.lanes) {
      this.renderLane(lanesEl, lane, callbacks);
    }

    if (state.layout.errors.length > 0 || state.invalidNotes.length > 0) {
      this.renderErrors(root, state.layout.errors, state.invalidNotes);
    }
  }

  /**
   * Patches a single card's status badge, action buttons, and paused reply
   * surface in place (no full re-render), preserving the card's DOM node and the
   * live strip so streaming updates don't flicker.
   */
  patchCard(taskId: string, task: TaskSpec, pause?: AgentBoardPauseState | null): void {
    const refs = this.cardRefs.get(taskId);
    if (!refs) return;
    const status = task.frontmatter.status;

    refs.statusBadge.setText(DEFAULT_LANE_TITLES[status]);
    refs.statusBadge.className = `claudian-agent-board-status-badge claudian-agent-board-status-badge--${status}`;
    refs.card.className = `claudian-agent-board-card claudian-agent-board-card--${status}`;

    refs.actions.empty();
    this.renderActionsFor(refs.actions, task);

    if (refs.reply) {
      refs.reply.remove();
      refs.reply = null;
    }
    if (status === 'needs_input' || status === 'needs_approval') {
      refs.reply = this.renderReplySurface(refs.card, task, pause ?? null);
    }
  }

  /** Updates a card's elapsed timer, attempt pill, stale dot, and last ledger line in place. */
  patchLiveStrip(taskId: string, payload: AgentBoardLiveStripPayload): void {
    const refs = this.cardRefs.get(taskId);
    if (!refs || !refs.liveStripMeta || !refs.liveStripLedger) return;
    this.applyLiveStrip(refs.liveStripMeta, refs.liveStripLedger, payload);
  }

  private renderLane(parent: HTMLElement, lane: ResolvedLane, callbacks: AgentBoardRenderCallbacks): void {
    const laneEl = parent.createDiv({ cls: 'claudian-agent-board-lane' });
    const head = laneEl.createDiv({ cls: 'claudian-agent-board-lane-header' });
    head.createSpan({ text: lane.title });
    head.createSpan({ cls: 'claudian-agent-board-lane-count', text: String(lane.tasks.length) });

    if (lane.definitionOfReady.length > 0 || lane.definitionOfDone.length > 0) {
      this.renderCriteria(laneEl, lane);
    }

    for (const task of lane.tasks) {
      this.renderCard(laneEl, task, callbacks);
    }
  }

  private renderCriteria(laneEl: HTMLElement, lane: ResolvedLane): void {
    const criteria = laneEl.createDiv({ cls: 'claudian-agent-board-lane-criteria' });
    if (lane.definitionOfReady.length > 0) {
      criteria.createDiv({ cls: 'claudian-agent-board-lane-criteria-label', text: 'Ready when' });
      const list = criteria.createEl('ul');
      for (const item of lane.definitionOfReady) list.createEl('li', { text: item });
    }
    if (lane.definitionOfDone.length > 0) {
      criteria.createDiv({ cls: 'claudian-agent-board-lane-criteria-label', text: 'Done when' });
      const list = criteria.createEl('ul');
      for (const item of lane.definitionOfDone) list.createEl('li', { text: item });
    }
  }

  private renderCard(parent: HTMLElement, task: TaskSpec, callbacks: AgentBoardRenderCallbacks): void {
    const status = task.frontmatter.status;
    const card = parent.createDiv({ cls: `claudian-agent-board-card claudian-agent-board-card--${status}` });

    const titleRow = card.createDiv({ cls: 'claudian-agent-board-card-title-row' });
    titleRow.createDiv({ cls: 'claudian-agent-board-card-title', text: task.frontmatter.title });
    const statusBadge = titleRow.createSpan({
      cls: `claudian-agent-board-status-badge claudian-agent-board-status-badge--${status}`,
      text: DEFAULT_LANE_TITLES[status],
    });

    const meta = card.createDiv({ cls: 'claudian-agent-board-card-meta' });
    meta.createSpan({ text: `${task.frontmatter.provider ?? '—'} / ${task.frontmatter.model ?? '—'}` });
    meta.createSpan({ text: task.frontmatter.priority });

    const progress = parseAcceptanceProgress(task.sections.acceptanceCriteria);
    if (progress.total > 0) {
      const progressEl = card.createDiv({ cls: 'claudian-agent-board-card-progress' });
      const bar = progressEl.createEl('progress');
      bar.max = progress.total;
      bar.value = progress.done;
      progressEl.createSpan({
        cls: 'claudian-agent-board-card-progress-label',
        text: `${progress.done}/${progress.total}`,
      });
    }

    let liveStripMeta: HTMLElement | null = null;
    let liveStripLedger: HTMLElement | null = null;
    if (LIVE_STATUSES.has(status)) {
      const liveStrip = card.createDiv({ cls: 'claudian-agent-board-card-live-strip' });
      liveStripMeta = liveStrip.createDiv({ cls: 'claudian-agent-board-card-live-strip--meta' });
      liveStripLedger = liveStrip.createDiv({ cls: 'claudian-agent-board-card-live-strip--ledger' });
      this.applyLiveStrip(liveStripMeta, liveStripLedger, this.seedLiveStrip(task));
    }

    card.addEventListener('click', () => callbacks.onOpenDetail(task));
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      callbacks.onContextMenu(task, event);
    });

    const actions = card.createDiv({ cls: 'claudian-agent-board-card-actions' });
    this.renderActionsFor(actions, task);

    let reply: HTMLElement | null = null;
    if (status === 'needs_input' || status === 'needs_approval') {
      reply = this.renderReplySurface(card, task, null);
    }

    this.cardRefs.set(task.frontmatter.id, {
      card,
      statusBadge,
      liveStripMeta,
      liveStripLedger,
      actions,
      reply,
    });
  }

  /** Builds the action buttons for a task's current status (reused by initial render and patches). */
  private renderActionsFor(actions: HTMLElement, task: TaskSpec): void {
    const status = task.frontmatter.status;
    if (status === 'inbox') {
      this.renderAction(actions, 'Mark ready', () => this.callbacks?.onMarkReady(task));
    }
    if (status === 'ready' || status === 'needs_fix') {
      this.renderAction(actions, 'Run', () => this.callbacks?.onRun(task));
    }
    if (status === 'running') {
      this.renderAction(actions, 'Stop', () => this.callbacks?.onStop(task));
    }
    if (status === 'review') {
      this.renderAction(actions, 'Accept', () => this.callbacks?.onAccept(task));
      this.renderAction(actions, 'Rework', () => this.callbacks?.onRework(task));
    }
    if (status === 'done') {
      this.renderAction(actions, 'Reopen', () => this.callbacks?.onReopen(task));
    }
    if (status === 'needs_handoff') {
      this.renderAction(actions, 'Review', () => this.callbacks?.onSendToReview?.(task));
      this.renderAction(actions, 'Mark failed', () => this.callbacks?.onMarkFailed?.(task));
    }
  }

  private renderReplySurface(card: HTMLElement, task: TaskSpec, pause: AgentBoardPauseState | null): HTMLElement {
    const reply = card.createDiv({ cls: 'claudian-agent-board-card-reply' });
    // The card itself opens the detail view on click; keep reply interactions local.
    reply.addEventListener('click', (event) => event.stopPropagation());

    if (task.frontmatter.status === 'needs_input') {
      const question = pause?.question ?? task.frontmatter.pause_reason ?? 'The agent is waiting for your input.';
      reply.createDiv({ cls: 'claudian-agent-board-card-reply-prompt', text: question });
      const field = reply.createEl('input', {
        cls: 'claudian-agent-board-card-reply--field',
        type: 'text',
        placeholder: 'Your reply…',
      });
      if (pause?.defaultValue) field.value = pause.defaultValue;
      const actions = reply.createDiv({ cls: 'claudian-agent-board-card-reply--actions' });
      const submit = () => this.callbacks?.onReply?.(task, field.value);
      const send = actions.createEl('button', { cls: 'mod-cta', text: 'Send' });
      send.addEventListener('click', (event) => { event.stopPropagation(); submit(); });
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
      });
      const stop = actions.createEl('button', { text: 'Stop' });
      stop.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onCancelPaused?.(task); });
    } else {
      const action = pause?.action ?? task.frontmatter.pause_reason ?? 'The agent requests approval to proceed.';
      reply.createDiv({ cls: 'claudian-agent-board-card-reply-prompt', text: action });
      if (pause?.risk) {
        reply.createDiv({ cls: 'claudian-agent-board-card-reply-risk', text: `Risk: ${pause.risk}` });
      }
      const reason = reply.createEl('input', {
        cls: 'claudian-agent-board-card-reply--field',
        type: 'text',
        placeholder: 'Reason (used if you reject)…',
      });
      const actions = reply.createDiv({ cls: 'claudian-agent-board-card-reply--actions' });
      const approve = actions.createEl('button', { cls: 'mod-cta', text: 'Approve' });
      approve.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onApprove?.(task); });
      const reject = actions.createEl('button', { text: 'Reject' });
      reject.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callbacks?.onReject?.(task, reason.value.trim() || 'rejected');
      });
    }
    return reply;
  }

  private seedLiveStrip(task: TaskSpec): AgentBoardLiveStripPayload {
    const now = Date.now();
    const startedMs = task.frontmatter.started ? Date.parse(task.frontmatter.started) : now;
    const heartbeatMs = task.frontmatter.heartbeat ? Date.parse(task.frontmatter.heartbeat) : now;
    return {
      lastLedger: lastLineOf(task.sections.ledger) ?? undefined,
      elapsedMs: Math.max(0, now - startedMs),
      attemptNumber: task.frontmatter.attempts,
      heartbeatAgeMs: Math.max(0, now - heartbeatMs),
    };
  }

  private applyLiveStrip(metaEl: HTMLElement, ledgerEl: HTMLElement, payload: AgentBoardLiveStripPayload): void {
    const tier = staleTier(payload.heartbeatAgeMs);
    metaEl.className = `claudian-agent-board-card-live-strip--meta claudian-stale-${tier}`;
    metaEl.setText(`● ${formatElapsed(payload.elapsedMs)} · attempt ${payload.attemptNumber}`);
    ledgerEl.setText(payload.lastLedger ?? 'starting…');
  }

  private renderAction(parent: HTMLElement, label: string, handler: () => void): void {
    const button = parent.createEl('button', { text: label });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
  }

  private renderErrors(parent: HTMLElement, errors: string[], invalidNotes: InvalidTaskNote[]): void {
    const errorsEl = parent.createDiv({ cls: 'claudian-agent-board-errors' });
    if (errors.length > 0) {
      errorsEl.createEl('h4', { text: 'Board notices' });
      for (const message of errors) errorsEl.createDiv({ text: message });
    }
    if (invalidNotes.length > 0) {
      errorsEl.createEl('h4', { text: 'Skipped notes' });
      for (const note of invalidNotes) errorsEl.createDiv({ text: `${note.path}: ${note.error}` });
    }
  }
}

function lastLineOf(ledger: string): string | null {
  const lines = ledger.split('\n').filter((l) => l.trim().length > 0);
  return lines.length === 0 ? null : lines[lines.length - 1];
}

function staleTier(ageMs: number): 'green' | 'amber' | 'red' {
  if (ageMs < 60_000) return 'green';
  if (ageMs < 300_000) return 'amber';
  return 'red';
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
