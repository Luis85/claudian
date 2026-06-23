import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { renderAgentAvatar } from '../../agents/agentAvatar';
import { resolvePersona } from '../../agents/personaRegistry';
import { DEFAULT_LANE_TITLES, type ResolvedBoardLayout, type ResolvedLane } from '../config/boardConfigTypes';
import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import { isRunnableTaskStatus } from '../model/taskStateMachine';
import type { InvalidTaskNote, TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { AgentBoardCardActions, type AgentBoardRenderCallbacks } from './agentBoardCardActions';

export type { AgentBoardRenderCallbacks } from './agentBoardCardActions';

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

export interface AgentBoardRenderState {
  layout: ResolvedBoardLayout;
  invalidNotes: InvalidTaskNote[];
  slots: { used: number; max: number };
  queue?: QueueToolbarState;
}

interface CardRefs {
  card: HTMLElement;
  /** Small title-row status dot (replaces the old text status badge). */
  statusDot: HTMLElement;
  /** Hover action cluster (primary + ⋯). Rebuilt on a status patch so the
   *  per-status primary + menu track the new status without a full re-render. */
  actions: HTMLElement;
  liveStripMeta: HTMLElement | null;
  liveStripLedger: HTMLElement | null;
  /** Card footer (progress + assignee). Hidden, not destroyed, while a reply shows. */
  footer: HTMLElement;
  /** Reserved 20px footer avatar surface — empty here; filled by the persona slice. */
  assigneeSlot: HTMLElement;
  reply: HTMLElement | null;
}

const LIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(['running', 'needs_input', 'needs_approval']);

const PRIORITY_TOTAL_BARS = 3;

/**
 * Priority → { filled-bar count, modifier suffix } for the card's ascending
 * priority bars + label. Colors are applied in CSS via the modifier class,
 * reading the contract in the redesign plan (urgent red / high orange /
 * normal yellow / low base-60). Bars fill ascending: urgent 3, high 3,
 * normal 2, low 1.
 */
const PRIORITY_META: Record<TaskPriority, { bars: number; modifier: string }> = {
  '0 - urgent': { bars: 3, modifier: 'urgent' },
  '1 - high': { bars: 3, modifier: 'high' },
  '2 - normal': { bars: 2, modifier: 'normal' },
  '3 - low': { bars: 1, modifier: 'low' },
};

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
  private cardActionsInstance: AgentBoardCardActions | null = null;

  private get cardActions(): AgentBoardCardActions {
    if (!this.cardActionsInstance) {
      this.cardActionsInstance = new AgentBoardCardActions({
        getCallbacks: () => this.callbacks,
      });
    }
    return this.cardActionsInstance;
  }

  render(container: HTMLElement, state: AgentBoardRenderState, callbacks: AgentBoardRenderCallbacks): void {
    this.callbacks = callbacks;
    this.cardActions.closePopover();
    this.cardRefs.clear();
    container.empty();
    const root = container.createDiv({ cls: 'specorator-agent-board' });

    const hasRunnable = state.layout.lanes.some((lane) =>
      lane.tasks.some((task) => isRunnableTaskStatus(task.frontmatter.status)),
    );
    const { free, slotsEl } = this.renderBoardToolbar(root, state, callbacks, hasRunnable);
    if (free <= 0) {
      slotsEl.addClass('specorator-agent-board-slots--full');
      root.createDiv({
        cls: 'specorator-agent-board-hint',
        text: t('tasks.board.noFreeSlots'),
      });
    }

    const lanesEl = root.createDiv({ cls: 'specorator-agent-board-lanes' });
    for (const lane of state.layout.lanes) {
      this.renderLane(lanesEl, lane, callbacks);
    }

    if (state.layout.errors.length > 0 || state.invalidNotes.length > 0) {
      this.renderErrors(root, state.layout.errors, state.invalidNotes);
    }
  }

  /**
   * Patches a single card's status dot (color + live-pulse class), status
   * modifier, hover action cluster, and paused reply surface in place (no full
   * re-render), preserving the card's DOM node and the live strip so streaming
   * updates don't flicker. The cluster is rebuilt so its per-status primary + ⋯
   * menu track the new status (e.g. running's Stop → review's Accept).
   */
  patchCard(taskId: string, task: TaskSpec, pause?: AgentBoardPauseState | null): void {
    const refs = this.cardRefs.get(taskId);
    if (!refs) return;
    const status = task.frontmatter.status;
    const live = LIVE_STATUSES.has(status);

    this.applyStatusDot(refs.statusDot, status);
    refs.card.className = `specorator-agent-board-card specorator-agent-board-card--${status}${live ? ' specorator-agent-board-card--live-actions' : ''}`;

    // Rebuild the cluster for the new status. A patch may cross live/non-live or
    // change which primary/menu applies; rebuilding (rather than mutating in
    // place) keeps the action seam in sync. Any open ⋯ popover this card owned
    // is closed first so its portaled node + listeners don't outlive its trigger.
    this.cardActions.closePopover();
    refs.actions.remove();
    refs.actions = this.cardActions.insertCardActions(refs.card, refs.statusDot, task, live);

    // The footer is hidden (not destroyed) while a reply surface shows, so a
    // resumed card recovers its progress + assignee seam without a full render.
    const showReply = status === 'needs_input' || status === 'needs_approval';
    refs.footer.toggleClass('is-hidden', showReply);
    if (refs.reply) {
      refs.reply.remove();
      refs.reply = null;
    }
    if (showReply) {
      refs.reply = this.renderReplySurface(refs.card, task, pause ?? null);
    }
  }

  /** Repaints a card's freshness dot, elapsed + attempt caption, and last ledger line in place (no rebuild). */
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
    // A removed card may own the open ⋯ popover; tear it down so the portaled
    // node + its listeners don't outlive the card they acted on.
    this.cardActions.closePopover();
    refs.card.remove();
    this.cardRefs.delete(taskId);
  }

  private renderBoardToolbar(
    root: HTMLElement,
    state: AgentBoardRenderState,
    callbacks: AgentBoardRenderCallbacks,
    hasRunnable: boolean,
  ): { free: number; slotsEl: HTMLElement } {
    const bar = root.createDiv({ cls: 'specorator-agent-board-toolbar' });
    const actions = bar.createDiv({ cls: 'specorator-agent-board-toolbar-actions' });
    const info = bar.createDiv({ cls: 'specorator-agent-board-toolbar-info' });

    // Accent CTA. Shares the equalized button size with "Run next ready" via the
    // base toolbar-btn class; `mod-cta` keeps the accent fill.
    const addButton = actions.createEl('button', {
      cls: 'specorator-agent-board-toolbar-btn mod-cta',
      text: t('tasks.board.addWorkOrderButton'),
    });
    addButton.addEventListener('click', () => callbacks.onAddWorkOrder());

    if (hasRunnable) {
      // Tool button (secondary surface) with a leading play icon.
      const runNextBtn = actions.createEl('button', {
        cls: 'specorator-agent-board-toolbar-btn specorator-agent-board-toolbar-btn--tool',
      });
      const icon = runNextBtn.createSpan({ cls: 'specorator-agent-board-toolbar-btn-icon' });
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('data-icon', 'play');
      setIcon(icon, 'play');
      runNextBtn.createSpan({ text: t('tasks.board.runNextReady') });
      runNextBtn.addEventListener('click', () => callbacks.onRunNextReady());
    }

    if (state.queue) {
      // Divider separates the board actions from the Auto-run switch.
      actions.createDiv({ cls: 'specorator-agent-board-toolbar-divider' });
      this.renderAutoRunSwitch(actions, state.queue);
      this.renderQueueInfo(info, state.queue);
    }

    const free = Math.max(0, state.slots.max - state.slots.used);
    const slotsEl = info.createSpan({
      cls: 'specorator-agent-board-slots',
      text: t('tasks.board.tabCount', { n: state.slots.used, m: state.slots.max, k: free }),
    });
    return { free, slotsEl };
  }

  /**
   * The Auto-run switch (renamed background-watcher toggle). `role="switch"`,
   * `aria-checked` mirrors the on/off state, and a tooltip explains the
   * background behavior. ON ⇒ watcher running, OFF ⇒ watcher paused — the click
   * (and Enter / Space) route through the unchanged `onToggle`. A halt forces an
   * OFF presentation: the watcher cannot auto-run while halted, so the switch
   * reads OFF even if the user has not paused it.
   */
  private renderAutoRunSwitch(parent: HTMLElement, state: QueueToolbarState): void {
    const on = !state.paused && !state.halted;
    const sw = parent.createEl('button', {
      cls: `specorator-agent-board-toolbar-autorun specorator-agent-board-toolbar-autorun--${on ? 'on' : 'off'}`,
      attr: { type: 'button', role: 'switch' },
    });
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    const tooltip = t('tasks.board.autoRun.tooltip');
    sw.setAttribute('title', tooltip);
    sw.setAttribute('aria-label', tooltip);

    const track = sw.createSpan({ cls: 'specorator-agent-board-toolbar-autorun-track' });
    track.createSpan({
      cls: `specorator-agent-board-toolbar-autorun-thumb${on ? ' specorator-agent-board-toolbar-autorun-thumb--on' : ''}`,
    });
    sw.createSpan({
      cls: 'specorator-agent-board-toolbar-autorun-label',
      text: t('tasks.board.autoRun.label'),
    });

    // A native <button> activates on click AND on Enter/Space (the browser
    // synthesizes the click), so one click handler covers keyboard use without
    // a manual keydown path that would fire onToggle a second time.
    sw.addEventListener('click', () => state.onToggle());
  }

  private renderQueueInfo(parent: HTMLElement, state: QueueToolbarState): void {
    const active = parent.createSpan({ cls: 'specorator-agent-board-toolbar--queue-active-count' });
    // Soft-ring dot precedes the "N/M active" caption (the dot is the at-a-glance
    // live signal; the caption is the accessible count).
    const dot = active.createSpan({ cls: 'specorator-agent-board-toolbar-active-dot' });
    dot.setAttribute('aria-hidden', 'true');
    active.createSpan({
      text: t('tasks.board.activeCount', { n: state.slotOccupied, m: state.slotCapacity }),
    });

    // Halt/failure caption uses the historical "Queue" wording, now keyed.
    if (state.halted && state.haltReason) {
      parent.createSpan({
        cls: 'specorator-agent-board-toolbar--queue-failure-count',
        text: t('tasks.board.queueHalted', { reason: state.haltReason }),
      });
      return;
    }

    if (state.consecutiveFailures > 0) {
      parent.createSpan({
        cls: 'specorator-agent-board-toolbar--queue-failure-count',
        text:
          state.consecutiveFailures === 1
            ? t('tasks.board.failureOne', { n: state.consecutiveFailures })
            : t('tasks.board.failureMany', { n: state.consecutiveFailures }),
      });
    }
  }

  renderSkipChip(host: HTMLElement, state: SkipChipState): void {
    host.empty();
    if (!state.reason) return;
    const chip = host.createDiv({
      cls: 'specorator-agent-board-card-skip-chip',
      text: t('tasks.board.queueSkipped', { reason: state.reason }),
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

    const laneEl = parent.createDiv({ cls: 'specorator-agent-board-lane' });
    const head = laneEl.createDiv({ cls: 'specorator-agent-board-lane-header' });
    head.createSpan({ cls: 'specorator-agent-board-lane-title', text: lane.title });
    const meta = head.createDiv({ cls: 'specorator-agent-board-lane-header-meta' });
    meta.createSpan({ cls: 'specorator-agent-board-lane-count', text: String(lane.tasks.length) });
    if (lane.collapsible) {
      // Real Lucide chevron (rendered via setIcon), matching the icon language
      // of every other card glyph. The accessible name comes from the keyed
      // aria-label below; the glyph is decorative (data-icon mirrors it for tests).
      const toggle = meta.createEl('button', {
        cls: 'specorator-agent-board-lane-collapse-toggle',
      });
      toggle.setAttribute('aria-label', t('tasks.board.collapseLane'));
      toggle.setAttribute('data-icon', 'chevron-down');
      setIcon(toggle, 'chevron-down');
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
      cls: 'specorator-agent-board-lane-add',
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
      cls: 'specorator-agent-board-lane specorator-agent-board-lane--collapsed',
    });
    strip.setAttribute('role', 'button');
    strip.setAttribute('aria-label', t('tasks.board.expandLane', { title: lane.title }));
    strip.setAttribute('aria-expanded', 'false');
    // Keyboard reachable: a collapsed lane is a real interactive control, so
    // tab-focus must reach it. Enter / Space activate the toggle the same way
    // a click does (native semantic for role="button").
    strip.setAttribute('tabindex', '0');
    // Leading Lucide chevron at the top of the strip (spec Board.jsx). Decorative
    // (the accessible name lives on the strip's aria-label); data-icon mirrors it.
    const chevron = strip.createSpan({ cls: 'specorator-agent-board-lane-collapsed-chevron' });
    chevron.setAttribute('aria-hidden', 'true');
    chevron.setAttribute('data-icon', 'chevron-right');
    setIcon(chevron, 'chevron-right');
    strip.createSpan({
      cls: 'specorator-agent-board-lane-title-vertical',
      text: lane.title,
    });
    strip.createSpan({
      cls: 'specorator-agent-board-lane-count',
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
    const criteria = laneEl.createDiv({ cls: 'specorator-agent-board-lane-criteria' });
    if (lane.definitionOfReady.length > 0) {
      criteria.createDiv({ cls: 'specorator-agent-board-lane-criteria-label', text: t('tasks.board.readyWhen') });
      const list = criteria.createEl('ul');
      for (const item of lane.definitionOfReady) list.createEl('li', { text: item });
    }
    if (lane.definitionOfDone.length > 0) {
      criteria.createDiv({ cls: 'specorator-agent-board-lane-criteria-label', text: t('tasks.board.doneWhen') });
      const list = criteria.createEl('ul');
      for (const item of lane.definitionOfDone) list.createEl('li', { text: item });
    }
  }

  private renderCard(parent: HTMLElement, task: TaskSpec, callbacks: AgentBoardRenderCallbacks): void {
    const status = task.frontmatter.status;
    const live = LIVE_STATUSES.has(status);
    const card = parent.createDiv({
      // `--live-actions` keeps the title's right padding reserved so the
      // always-visible cluster on live cards never overlaps the title text.
      cls: `specorator-agent-board-card specorator-agent-board-card--${status}${live ? ' specorator-agent-board-card--live-actions' : ''}`,
    });

    const titleRow = card.createDiv({ cls: 'specorator-agent-board-card-title-row' });
    const statusDot = titleRow.createSpan({ cls: 'specorator-agent-board-card-status-dot' });
    this.applyStatusDot(statusDot, status);
    titleRow.createDiv({ cls: 'specorator-agent-board-card-title', text: task.frontmatter.title });

    // Hover action cluster: floats over the card's top-right (absolute), so it
    // reserves no layout width — titles keep their full width. Always-visible on
    // live cards; reveal-on-hover/focus otherwise (CSS-gated).
    const actions = this.cardActions.renderCardActions(card, task, live);

    this.renderMetaRow(card, task);

    // The footer is always built (so its progress + assignee patch seams stay
    // live across status changes) but hidden while the reply surface is shown.
    const showReply = status === 'needs_input' || status === 'needs_approval';
    const { footer, assignee: assigneeSlot } = this.renderFooter(card, task);
    if (showReply) footer.addClass('is-hidden');

    let liveStripMeta: HTMLElement | null = null;
    let liveStripLedger: HTMLElement | null = null;
    if (LIVE_STATUSES.has(status)) {
      // Top-bordered live band: line 1 is a freshness dot + caption, line 2 is
      // the last ledger line. The dot + caption are stable child nodes so
      // `patchLiveStrip` can repaint them in place (no node churn on heartbeat).
      const liveStrip = card.createDiv({ cls: 'specorator-agent-board-card-live-strip' });
      liveStripMeta = liveStrip.createDiv({ cls: 'specorator-agent-board-card-live-strip--meta' });
      liveStripMeta.createSpan({ cls: 'specorator-agent-board-card-live-strip--dot' });
      liveStripMeta.createSpan({ cls: 'specorator-agent-board-card-live-strip--caption' });
      liveStripLedger = liveStrip.createDiv({ cls: 'specorator-agent-board-card-live-strip--ledger' });
      this.applyLiveStrip(liveStripMeta, liveStripLedger, this.seedLiveStrip(task));
    }

    card.addEventListener('click', () => callbacks.onOpenDetail(task));
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      callbacks.onContextMenu(task, event);
    });

    // The reply surface below (needs_input / needs_approval) is the live run's
    // own control set — it is NOT the hover action cluster (rendered above).
    let reply: HTMLElement | null = null;
    if (showReply) {
      reply = this.renderReplySurface(card, task, null);
    }

    this.renderSkipChipFor(card, task, callbacks);

    this.cardRefs.set(task.frontmatter.id, {
      card,
      statusDot,
      actions,
      liveStripMeta,
      liveStripLedger,
      footer,
      assigneeSlot,
      reply,
    });
  }

  /** Paints the title-row status dot's color + live-pulse class + a11y label. */
  private applyStatusDot(dot: HTMLElement, status: TaskStatus): void {
    const live = LIVE_STATUSES.has(status) ? ' specorator-agent-board-card-status-dot--live' : '';
    dot.className = `specorator-agent-board-card-status-dot specorator-agent-board-card-status-dot--${status}${live}`;
    const label = DEFAULT_LANE_TITLES[status];
    dot.setAttribute('aria-label', label);
    dot.setAttribute('title', label);
  }

  /** Meta row: provider/model (truncated) on the left, priority bars + label on the right. */
  private renderMetaRow(card: HTMLElement, task: TaskSpec): void {
    const meta = card.createDiv({ cls: 'specorator-agent-board-card-meta' });
    meta.createSpan({
      cls: 'specorator-agent-board-card-meta-engine',
      text: `${task.frontmatter.provider ?? '—'} / ${task.frontmatter.model ?? '—'}`,
    });
    this.renderPriority(meta, task.frontmatter.priority);
  }

  /** Ascending priority bars (filled per level) + the priority label. */
  private renderPriority(parent: HTMLElement, priority: TaskPriority): void {
    // Legacy or hand-authored notes can carry an unrecognized priority (e.g.
    // `normal`); fall back to the normal styling so one bad value can't abort
    // the whole board render. The label below still shows the raw value.
    const meta =
      (PRIORITY_META as Record<string, { bars: number; modifier: string }>)[priority] ??
      PRIORITY_META['2 - normal'];
    const prio = parent.createSpan({
      cls: `specorator-agent-board-card-priority specorator-agent-board-card-priority--${meta.modifier}`,
    });
    const bars = prio.createSpan({ cls: 'specorator-agent-board-card-priority-bars' });
    bars.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= PRIORITY_TOTAL_BARS; i++) {
      const filled = i <= meta.bars ? ' is-filled' : '';
      bars.createSpan({ cls: `specorator-agent-board-card-priority-bar${filled}` });
    }
    prio.createSpan({ cls: 'specorator-agent-board-card-priority-label', text: priority });
  }

  /** Avatar diameter (px) for the card footer assignee slot. */
  private static readonly ASSIGNEE_AVATAR_SIZE = 20;

  /**
   * Footer row: acceptance progress (track + done/total, green at 100%) on the
   * left, the 20px assignee avatar on the far right. When progress is absent, a
   * spacer keeps the slot right-aligned. The assignee resolves from the work
   * order's `agent` frontmatter through `resolvePersona` (absent / unknown →
   * Standard); the avatar carries the persona name as its `title` tooltip.
   * Returns the footer + assignee elements so both can be cached as patch seams.
   */
  private renderFooter(
    card: HTMLElement,
    task: TaskSpec,
  ): { footer: HTMLElement; assignee: HTMLElement } {
    const footer = card.createDiv({ cls: 'specorator-agent-board-card-footer' });
    const progress = parseAcceptanceProgress(task.sections.acceptanceCriteria);
    if (progress.total > 0) {
      const complete = progress.done >= progress.total;
      const progressEl = footer.createDiv({
        cls: `specorator-agent-board-card-progress${complete ? ' is-complete' : ''}`,
      });
      progressEl.setAttribute('title', `${progress.done}/${progress.total}`);
      const track = progressEl.createSpan({ cls: 'specorator-agent-board-card-progress-track' });
      const fill = track.createSpan({ cls: 'specorator-agent-board-card-progress-fill' });
      fill.style.width = `${(progress.done / progress.total) * 100}%`;
      progressEl.createSpan({
        cls: 'specorator-agent-board-card-progress-count',
        text: `${progress.done}/${progress.total}`,
      });
    } else {
      footer.createSpan({ cls: 'specorator-agent-board-card-footer-spacer' });
    }
    const assignee = footer.createSpan({ cls: 'specorator-agent-board-card-assignee' });
    renderAgentAvatar(
      assignee,
      (this.callbacks?.resolvePersona ?? resolvePersona)(task.frontmatter.agent),
      AgentBoardRenderer.ASSIGNEE_AVATAR_SIZE,
    );
    return { footer, assignee };
  }

  private renderSkipChipFor(card: HTMLElement, task: TaskSpec, callbacks: AgentBoardRenderCallbacks): void {
    const skipReason = callbacks.getSkipReason?.(task) ?? null;
    if (!skipReason) return;
    const chipHost = card.createDiv({ cls: 'specorator-agent-board-card-skip-host' });
    this.renderSkipChip(chipHost, { reason: skipReason, onAck: () => callbacks.onAckSkip?.(task) });
  }

  /**
   * Render the pause prompt (question / approval action) preserving paragraph
   * breaks. `createDiv({ text })` collapses newlines on display, so a multi-line
   * agent question would render as one wall of text. Splitting by blank line
   * keeps the original visual structure without enabling Markdown.
   */
  private renderPromptText(parent: HTMLElement, prompt: string): void {
    const host = parent.createDiv({ cls: 'specorator-agent-board-card-reply-prompt' });
    const paragraphs = prompt.split(/\n{2,}/);
    if (paragraphs.length === 1) {
      // Single paragraph: still honor inline newlines via CSS pre-wrap class.
      host.addClass('specorator-agent-board-card-reply-prompt--prewrap');
      host.setText(prompt);
      return;
    }
    for (const paragraph of paragraphs) {
      host.createDiv({
        cls: 'specorator-agent-board-card-reply-prompt-paragraph',
        text: paragraph,
      });
    }
  }

  private renderReplySurface(card: HTMLElement, task: TaskSpec, pause: AgentBoardPauseState | null): HTMLElement {
    const reply = card.createDiv({ cls: 'specorator-agent-board-card-reply' });
    // The card itself opens the detail view on click; keep reply interactions local.
    reply.addEventListener('click', (event) => event.stopPropagation());

    if (task.frontmatter.status === 'needs_input') {
      const question = pause?.question ?? task.frontmatter.pause_reason ?? t('tasks.board.card.reply.waitingForInput');
      this.renderPromptText(reply, question);
      const field = reply.createEl('input', {
        cls: 'specorator-agent-board-card-reply--field',
        type: 'text',
        placeholder: t('tasks.board.card.reply.inputPlaceholder'),
      });
      // Cap reply length so a pasted megabyte doesn't reach the runtime and
      // fail there with a cryptic error. 4000 chars is well below any provider
      // input cap but high enough for a real long-form reply.
      field.maxLength = REPLY_INPUT_MAX_LENGTH;
      if (pause?.defaultValue) field.value = pause.defaultValue;
      const actions = reply.createDiv({ cls: 'specorator-agent-board-card-reply--actions' });
      const submit = () => this.callbacks?.onReply?.(task, field.value);
      const send = actions.createEl('button', { cls: 'mod-cta', text: t('tasks.board.card.reply.send') });
      send.addEventListener('click', (event) => { event.stopPropagation(); submit(); });
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
      });
      const stop = actions.createEl('button', { text: t('tasks.board.card.reply.stop') });
      stop.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onCancelPaused?.(task); });
    } else {
      const action = pause?.action ?? task.frontmatter.pause_reason ?? t('tasks.board.card.reply.requestsApproval');
      this.renderPromptText(reply, action);
      if (pause?.risk) {
        reply.createDiv({
          cls: 'specorator-agent-board-card-reply-risk',
          text: t('tasks.board.card.reply.risk', { risk: pause.risk }),
        });
      }
      const reason = reply.createEl('input', {
        cls: 'specorator-agent-board-card-reply--field',
        type: 'text',
        placeholder: t('tasks.board.card.reply.rejectReasonPlaceholder'),
      });
      reason.maxLength = REPLY_INPUT_MAX_LENGTH;
      const actions = reply.createDiv({ cls: 'specorator-agent-board-card-reply--actions' });
      const approve = actions.createEl('button', { cls: 'mod-cta', text: t('tasks.board.card.reply.approve') });
      approve.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onApprove?.(task); });
      const reject = actions.createEl('button', { text: t('tasks.board.card.reply.reject') });
      reject.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callbacks?.onReject?.(task, reason.value.trim() || t('tasks.board.card.reply.defaultRejectReason'));
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
    // The freshness dot carries the tier color class; line 1's caption is the
    // elapsed + attempt counter. Both repaint the stable child nodes seeded in
    // `renderCard` so `patchLiveStrip` is an in-place update, not a rebuild.
    const dot = metaEl.querySelector<HTMLElement>('.specorator-agent-board-card-live-strip--dot');
    const caption = metaEl.querySelector<HTMLElement>('.specorator-agent-board-card-live-strip--caption');
    if (dot) {
      // Per-tier glyph + aria-label so color-blind users still get the freshness
      // signal (the glyph is the non-color cue). The bullet (●) is the basic
      // "live" indicator; tier escalates to a half/empty glyph for amber/red.
      const glyph = tier === 'green' ? '●' : tier === 'amber' ? '◐' : '◯';
      dot.className = `specorator-agent-board-card-live-strip--dot specorator-stale-${tier}`;
      dot.setText(glyph);
      dot.setAttribute('aria-label', staleAriaLabel(tier, payload.heartbeatAgeMs));
    }
    caption?.setText(
      t('tasks.board.card.liveStrip.attempt', {
        elapsed: formatElapsed(payload.elapsedMs),
        attempt: payload.attemptNumber,
      }),
    );
    ledgerEl.setText(payload.lastLedger ?? t('tasks.board.card.liveStrip.starting'));
  }

  private renderErrors(parent: HTMLElement, errors: string[], invalidNotes: InvalidTaskNote[]): void {
    const errorsEl = parent.createDiv({ cls: 'specorator-agent-board-errors' });
    if (errors.length > 0) {
      errorsEl.createEl('h4', { text: t('tasks.board.boardNotices') });
      // Cap each error line at 300 chars so a long path/stack doesn't blow out
      // the lane width or push the lanes off-screen. Full text stays available
      // via the title tooltip on hover.
      for (const message of errors) {
        const div = errorsEl.createDiv({ text: truncateErrorLine(message) });
        div.title = message;
      }
    }
    if (invalidNotes.length > 0) {
      errorsEl.createEl('h4', { text: t('tasks.board.skippedNotes') });
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
  if (tier === 'green') return t('tasks.board.card.liveStrip.heartbeatFresh', { age });
  if (tier === 'amber') return t('tasks.board.card.liveStrip.heartbeatStale', { age });
  return t('tasks.board.card.liveStrip.heartbeatVeryStale', { age });
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
