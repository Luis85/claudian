import { t } from '../../../i18n/i18n';
import { DEFAULT_LANE_TITLES, type ResolvedBoardLayout, type ResolvedLane } from '../config/boardConfigTypes';
import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import { isRunnableTaskStatus } from '../model/taskStateMachine';
import type { InvalidTaskNote, TaskSpec, TaskStatus } from '../model/taskTypes';

/** Lane id of the Inbox lane — the only lane that hosts the add-work-order row. */

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
  onMoveToInbox(task: TaskSpec): void;
  onAddWorkOrder(): void;
  onRunNextReady(): void;
  /** Queue skip reason for a card, or null when the card is not skipped. */
  getSkipReason?: (task: TaskSpec) => string | null;
  /** Dismiss a card's queue skip chip. */
  onAckSkip?: (task: TaskSpec) => void;
  onContextMenu(task: TaskSpec, event: MouseEvent): void;
  onToggleLaneCollapse(laneId: string): void;
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
  queue?: QueueToolbarState;
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

/**
 * Cap for the reply / reject-reason input. Large enough for a long-form
 * paragraph; small enough that a pasted megabyte can't reach the runtime and
 * fail there with a cryptic error.
 */
const REPLY_INPUT_MAX_LENGTH = 4000;

export interface QueueToolbarState {
  paused: boolean;
  halted: boolean;
  slotOccupied: number;
  slotCapacity: number;
  consecutiveFailures: number;
  haltReason?: string | null;
  onToggle: () => void;
}

export interface SkipChipState {
  reason: string | null;
  onAck: () => void;
}

export class AgentBoardRenderer {
  private cardRefs = new Map<string, CardRefs>();
  private callbacks: AgentBoardRenderCallbacks | null = null;

  render(container: HTMLElement, state: AgentBoardRenderState, callbacks: AgentBoardRenderCallbacks): void {
    this.callbacks = callbacks;
    this.cardRefs.clear();
    container.empty();
    const root = container.createDiv({ cls: 'claudian-agent-board' });

    const hasRunnable = state.layout.lanes.some((lane) =>
      lane.tasks.some((task) => isRunnableTaskStatus(task.frontmatter.status)),
    );
    const { free, slotsEl } = this.renderBoardToolbar(root, state, callbacks, hasRunnable);
    if (free <= 0) {
      slotsEl.addClass('claudian-agent-board-slots--full');
      root.createDiv({
        cls: 'claudian-agent-board-hint',
        text: 'No free work-order slots. A work-order run needs a free slot — close a work-order tab in the chat panel, or raise "Concurrent work-order runs" in Agent Board settings.',
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

  /**
   * Drop the cached card refs for a task that no longer exists in the model
   * (vault delete, archive). Without this, `cardRefs` would hold a reference
   * to the detached DOM node until the next full `render()` clears the map —
   * fine in steady state, but a leak window for any path that mutates the
   * model without an immediate re-render. The DOM is also detached defensively
   * so a stale handler can't reach a removed-but-still-mounted card.
   */
  removeCard(taskId: string): void {
    const refs = this.cardRefs.get(taskId);
    if (!refs) return;
    refs.card.remove();
    this.cardRefs.delete(taskId);
  }

  private renderBoardToolbar(
    root: HTMLElement,
    state: AgentBoardRenderState,
    callbacks: AgentBoardRenderCallbacks,
    hasRunnable: boolean,
  ): { free: number; slotsEl: HTMLElement } {
    const bar = root.createDiv({ cls: 'claudian-agent-board-toolbar' });
    const actions = bar.createDiv({ cls: 'claudian-agent-board-toolbar-actions' });
    const info = bar.createDiv({ cls: 'claudian-agent-board-toolbar-info' });

    const addButton = actions.createEl('button', { cls: 'mod-cta', text: 'Add work order' });
    addButton.addEventListener('click', () => callbacks.onAddWorkOrder());

    if (hasRunnable) {
      const runNextBtn = actions.createEl('button', { text: 'Run next ready' });
      runNextBtn.addEventListener('click', () => callbacks.onRunNextReady());
    }

    if (state.queue) this.renderQueueToggle(actions, state.queue);
    if (state.queue) this.renderQueueInfo(info, state.queue);

    const free = Math.max(0, state.slots.max - state.slots.used);
    const slotsEl = info.createSpan({
      cls: 'claudian-agent-board-slots',
      text: `Work-order tabs ${state.slots.used}/${state.slots.max} · ${free} free`,
    });
    return { free, slotsEl };
  }

  private renderQueueToggle(parent: HTMLElement, state: QueueToolbarState): void {
    const toggle = parent.createEl('button', {
      cls: 'claudian-agent-board-toolbar--queue-toggle',
      text: state.paused || state.halted ? 'Run queue' : 'Pause queue',
    });
    if (state.halted) toggle.addClass('claudian-agent-board-toolbar--queue-toggle-halted');
    toggle.addEventListener('click', () => state.onToggle());
  }

  private renderQueueInfo(parent: HTMLElement, state: QueueToolbarState): void {
    parent.createSpan({
      cls: 'claudian-agent-board-toolbar--queue-active-count',
      text: `${state.slotOccupied}/${state.slotCapacity} active`,
    });

    if (state.halted && state.haltReason) {
      parent.createSpan({
        cls: 'claudian-agent-board-toolbar--queue-failure-count',
        text: `Queue halted: ${state.haltReason}`,
      });
      return;
    }

    if (state.consecutiveFailures > 0) {
      parent.createSpan({
        cls: 'claudian-agent-board-toolbar--queue-failure-count',
        text: `${state.consecutiveFailures} ${state.consecutiveFailures === 1 ? 'failure' : 'failures'}`,
      });
    }
  }

  renderSkipChip(host: HTMLElement, state: SkipChipState): void {
    host.empty();
    if (!state.reason) return;
    const chip = host.createDiv({
      cls: 'claudian-agent-board-card-skip-chip',
      text: `⊘ Queue skipped: ${state.reason}`,
    });
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      state.onAck();
    });
  }

  private renderLane(parent: HTMLElement, lane: ResolvedLane, callbacks: AgentBoardRenderCallbacks): void {
    if (lane.collapsible && lane.collapsed) {
      this.renderCollapsedLane(parent, lane, callbacks);
      return;
    }

    const laneEl = parent.createDiv({ cls: 'claudian-agent-board-lane' });
    const head = laneEl.createDiv({ cls: 'claudian-agent-board-lane-header' });
    head.createSpan({ cls: 'claudian-agent-board-lane-title', text: lane.title });
    const meta = head.createDiv({ cls: 'claudian-agent-board-lane-header-meta' });
    meta.createSpan({ cls: 'claudian-agent-board-lane-count', text: String(lane.tasks.length) });
    if (lane.collapsible) {
      const toggle = meta.createEl('button', {
        cls: 'claudian-agent-board-lane-collapse-toggle',
        text: '›',
      });
      toggle.setAttribute('aria-label', 'Collapse lane');
      // Native <button> is already keyboard-reachable; aria-expanded mirrors the
      // collapsed-strip variant so screen readers announce the same state.
      toggle.setAttribute('aria-expanded', 'true');
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        callbacks.onToggleLaneCollapse(lane.id);
      });
    }

    if (lane.definitionOfReady.length > 0 || lane.definitionOfDone.length > 0) {
      this.renderCriteria(laneEl, lane);
    }

    for (const task of lane.tasks) {
      this.renderCard(laneEl, task, callbacks);
    }

    // The dashed add-work-order affordance belongs to the single lane that
    // receives new (inbox-status) work orders — the resolver flags exactly one,
    // so it survives a removed/remapped/duplicated Inbox lane.
    if (lane.hostsNewWorkOrders) {
      this.renderAddWorkOrderRow(laneEl, callbacks);
    }
  }

  private renderAddWorkOrderRow(laneEl: HTMLElement, callbacks: AgentBoardRenderCallbacks): void {
    const addRow = laneEl.createEl('button', {
      cls: 'claudian-agent-board-lane-add',
      text: t('tasks.board.addWorkOrder'),
    });
    addRow.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.onAddWorkOrder();
    });
  }

  private renderCollapsedLane(
    parent: HTMLElement,
    lane: ResolvedLane,
    callbacks: AgentBoardRenderCallbacks,
  ): void {
    const strip = parent.createDiv({
      cls: 'claudian-agent-board-lane claudian-agent-board-lane--collapsed',
    });
    strip.setAttribute('role', 'button');
    strip.setAttribute('aria-label', `Expand lane ${lane.title}`);
    strip.setAttribute('aria-expanded', 'false');
    // Keyboard reachable: a collapsed lane is a real interactive control, so
    // tab-focus must reach it. Enter / Space activate the toggle the same way
    // a click does (native semantic for role="button").
    strip.setAttribute('tabindex', '0');
    strip.createSpan({
      cls: 'claudian-agent-board-lane-title-vertical',
      text: lane.title,
    });
    strip.createSpan({
      cls: 'claudian-agent-board-lane-count',
      text: String(lane.tasks.length),
    });
    const toggle = (): void => callbacks.onToggleLaneCollapse(lane.id);
    strip.addEventListener('click', toggle);
    strip.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
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

    this.renderSkipChipFor(card, task, callbacks);

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
    if (status === 'failed' || status === 'canceled') {
      this.renderAction(actions, 'Retry', () => this.callbacks?.onMarkReady(task));
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
    // Generic recovery is for non-live cards only. A live status (running /
    // needs_input / needs_approval) is driven by its reply surface (Send / Approve
    // / Reject / Stop); a bare status transition here would strand that paused
    // RunSession and leak the queue slot it still holds, so skip those.
    if (status !== 'inbox' && status !== 'done' && !LIVE_STATUSES.has(status)) {
      this.renderAction(actions, 'Back to inbox', () => this.callbacks?.onMoveToInbox(task));
    }
  }

  private renderSkipChipFor(card: HTMLElement, task: TaskSpec, callbacks: AgentBoardRenderCallbacks): void {
    const skipReason = callbacks.getSkipReason?.(task) ?? null;
    if (!skipReason) return;
    const chipHost = card.createDiv({ cls: 'claudian-agent-board-card-skip-host' });
    this.renderSkipChip(chipHost, { reason: skipReason, onAck: () => callbacks.onAckSkip?.(task) });
  }

  /**
   * Render the pause prompt (question / approval action) preserving paragraph
   * breaks. `createDiv({ text })` collapses newlines on display, so a multi-line
   * agent question would render as one wall of text. Splitting by blank line
   * keeps the original visual structure without enabling Markdown.
   */
  private renderPromptText(parent: HTMLElement, prompt: string): void {
    const host = parent.createDiv({ cls: 'claudian-agent-board-card-reply-prompt' });
    const paragraphs = prompt.split(/\n{2,}/);
    if (paragraphs.length === 1) {
      // Single paragraph: still honor inline newlines via CSS pre-wrap class.
      host.addClass('claudian-agent-board-card-reply-prompt--prewrap');
      host.setText(prompt);
      return;
    }
    for (const paragraph of paragraphs) {
      host.createDiv({
        cls: 'claudian-agent-board-card-reply-prompt-paragraph',
        text: paragraph,
      });
    }
  }

  private renderReplySurface(card: HTMLElement, task: TaskSpec, pause: AgentBoardPauseState | null): HTMLElement {
    const reply = card.createDiv({ cls: 'claudian-agent-board-card-reply' });
    // The card itself opens the detail view on click; keep reply interactions local.
    reply.addEventListener('click', (event) => event.stopPropagation());

    if (task.frontmatter.status === 'needs_input') {
      const question = pause?.question ?? task.frontmatter.pause_reason ?? 'The agent is waiting for your input.';
      this.renderPromptText(reply, question);
      const field = reply.createEl('input', {
        cls: 'claudian-agent-board-card-reply--field',
        type: 'text',
        placeholder: 'Your reply…',
      });
      // Cap reply length so a pasted megabyte doesn't reach the runtime and
      // fail there with a cryptic error. 4000 chars is well below any provider
      // input cap but high enough for a real long-form reply.
      field.maxLength = REPLY_INPUT_MAX_LENGTH;
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
      this.renderPromptText(reply, action);
      if (pause?.risk) {
        reply.createDiv({ cls: 'claudian-agent-board-card-reply-risk', text: `Risk: ${pause.risk}` });
      }
      const reason = reply.createEl('input', {
        cls: 'claudian-agent-board-card-reply--field',
        type: 'text',
        placeholder: 'Reason (used if you reject)…',
      });
      reason.maxLength = REPLY_INPUT_MAX_LENGTH;
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
    // Per-tier glyph + aria-label so color-blind users still get the freshness
    // signal. The bullet (●) is always present for the basic "live" indicator;
    // tier escalates to a warning/stop glyph for amber/red.
    const glyph = tier === 'green' ? '●' : tier === 'amber' ? '◐' : '◯';
    metaEl.setText(`${glyph} ${formatElapsed(payload.elapsedMs)} · attempt ${payload.attemptNumber}`);
    metaEl.setAttribute('aria-label', staleAriaLabel(tier, payload.heartbeatAgeMs));
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
      // Cap each error line at 300 chars so a long path/stack doesn't blow out
      // the lane width or push the lanes off-screen. Full text stays available
      // via the title tooltip on hover.
      for (const message of errors) {
        const div = errorsEl.createDiv({ text: truncateErrorLine(message) });
        div.title = message;
      }
    }
    if (invalidNotes.length > 0) {
      errorsEl.createEl('h4', { text: 'Skipped notes' });
      for (const note of invalidNotes) {
        const full = `${note.path}: ${note.error}`;
        const div = errorsEl.createDiv({ text: truncateErrorLine(full) });
        div.title = full;
      }
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

function staleAriaLabel(tier: 'green' | 'amber' | 'red', ageMs: number): string {
  const age = formatStaleAge(ageMs);
  if (tier === 'green') return `Fresh heartbeat (${age} ago)`;
  if (tier === 'amber') return `Stale heartbeat (${age} ago)`;
  return `Very stale heartbeat (${age} ago)`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

const ERROR_LINE_CAP = 300;

function truncateErrorLine(value: string): string {
  if (value.length <= ERROR_LINE_CAP) return value;
  return `${value.slice(0, ERROR_LINE_CAP - 1)}…`;
}

function formatStaleAge(ageMs: number): string {
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m`;
  return `${Math.round(ageMs / 3_600_000)}h`;
}
