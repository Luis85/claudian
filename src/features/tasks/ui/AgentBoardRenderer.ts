import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import { DEFAULT_LANE_TITLES, type ResolvedBoardLayout, type ResolvedLane } from '../config/boardConfigTypes';
import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import { isRunnableTaskStatus } from '../model/taskStateMachine';
import type { InvalidTaskNote, TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { PortalPopover, type PortalPopoverItem } from './portalPopover';

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
  /** ⋯ menu: move a terminal/inbox work order to the archive folder. */
  onArchive(task: TaskSpec): void;
  /** ⋯ menu: open the work-order note in a new tab. */
  onOpenNote(task: TaskSpec): void;
  /** ⋯ menu: open the linked conversation in a new tab. */
  onOpenConversation(task: TaskSpec): void;
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

/**
 * One card action — the per-status primary button or a ⋯ overflow-menu item.
 * `labelKey` resolves through the i18n helper; `icon` is a Lucide glyph;
 * `variant` keys the primary button styling; `danger` marks destructive ⋯ menu
 * items (red). `run` is resolved against the live callbacks at click time.
 */
interface CardAction {
  labelKey: TranslationKey;
  icon: string;
  variant?: 'cta' | 'danger' | 'ghost';
  danger?: boolean;
  run: (callbacks: AgentBoardRenderCallbacks, task: TaskSpec) => void;
}

interface CardActionModel {
  primary: CardAction | null;
  menu: CardAction[];
}

// Reusable ⋯ menu items (labels reuse the modal/context-menu keys where they
// already exist; board-only labels live under tasks.board.cardAction.*).
const MENU_OPEN_NOTE: CardAction = {
  labelKey: 'tasks.board.contextMenu.openNote',
  icon: 'file-text',
  run: (cb, task) => cb.onOpenNote(task),
};
const MENU_OPEN_CONVERSATION: CardAction = {
  labelKey: 'tasks.board.contextMenu.openConversation',
  icon: 'message-square',
  run: (cb, task) => cb.onOpenConversation(task),
};
const MENU_ARCHIVE: CardAction = {
  labelKey: 'tasks.board.contextMenu.archive',
  icon: 'archive',
  danger: true,
  run: (cb, task) => cb.onArchive(task),
};
const MENU_BACK_TO_INBOX: CardAction = {
  labelKey: 'tasks.board.cardAction.backToInbox',
  icon: 'rotate-ccw',
  run: (cb, task) => cb.onMoveToInbox(task),
};
const MENU_STOP: CardAction = {
  labelKey: 'tasks.workOrderModal.actionStop',
  icon: 'square',
  danger: true,
  run: (cb, task) => cb.onStop(task),
};
const MENU_REWORK: CardAction = {
  labelKey: 'tasks.workOrderModal.actionRework',
  icon: 'rotate-ccw',
  run: (cb, task) => cb.onRework(task),
};
const MENU_MARK_FAILED: CardAction = {
  labelKey: 'tasks.workOrderModal.actionMarkFailed',
  icon: 'triangle',
  danger: true,
  run: (cb, task) => cb.onMarkFailed?.(task),
};

/**
 * Per-status primary action + ⋯ overflow menu (the spec table). `needs_fix`
 * mirrors `ready` and `canceled` mirrors `failed` (both restored from the
 * pre-cluster recovery actions); any status the spec does not tabulate falls
 * back to an Open-note-only menu so every card stays actionable.
 */
const CARD_ACTIONS: Partial<Record<TaskStatus, CardActionModel>> = {
  inbox: {
    primary: { labelKey: 'tasks.workOrderModal.actionMarkReady', icon: 'check', variant: 'cta', run: (cb, task) => cb.onMarkReady(task) },
    // No "Run now": inbox items aren't runnable (must transition to ready first).
    menu: [MENU_OPEN_NOTE, MENU_ARCHIVE],
  },
  ready: {
    primary: { labelKey: 'tasks.board.cardAction.run', icon: 'play', variant: 'cta', run: (cb, task) => cb.onRun(task) },
    // No Archive: ready/needs_fix are actionable, not archivable (ARCHIVABLE_STATUSES).
    menu: [MENU_OPEN_NOTE, MENU_BACK_TO_INBOX],
  },
  needs_fix: {
    primary: { labelKey: 'tasks.board.cardAction.run', icon: 'play', variant: 'cta', run: (cb, task) => cb.onRun(task) },
    menu: [MENU_OPEN_NOTE, MENU_BACK_TO_INBOX],
  },
  running: {
    primary: { labelKey: 'tasks.workOrderModal.actionStop', icon: 'square', variant: 'danger', run: (cb, task) => cb.onStop(task) },
    menu: [MENU_OPEN_NOTE, MENU_OPEN_CONVERSATION],
  },
  needs_input: {
    primary: null,
    menu: [MENU_OPEN_NOTE, MENU_OPEN_CONVERSATION, MENU_STOP],
  },
  needs_approval: {
    primary: null,
    menu: [MENU_OPEN_NOTE, MENU_OPEN_CONVERSATION, MENU_STOP],
  },
  review: {
    primary: { labelKey: 'tasks.workOrderModal.actionAccept', icon: 'check', variant: 'cta', run: (cb, task) => cb.onAccept(task) },
    menu: [MENU_REWORK, MENU_OPEN_NOTE, MENU_OPEN_CONVERSATION, MENU_BACK_TO_INBOX],
  },
  needs_handoff: {
    primary: { labelKey: 'tasks.workOrderModal.actionSendToReview', icon: 'check', variant: 'cta', run: (cb, task) => cb.onSendToReview?.(task) },
    menu: [MENU_MARK_FAILED, MENU_OPEN_NOTE],
  },
  done: {
    primary: { labelKey: 'tasks.workOrderModal.actionReopen', icon: 'rotate-ccw', variant: 'ghost', run: (cb, task) => cb.onReopen(task) },
    menu: [MENU_OPEN_NOTE, MENU_ARCHIVE],
  },
  failed: {
    primary: { labelKey: 'tasks.board.cardAction.retry', icon: 'rotate-ccw', variant: 'cta', run: (cb, task) => cb.onMarkReady(task) },
    menu: [MENU_OPEN_NOTE, MENU_ARCHIVE],
  },
  canceled: {
    primary: { labelKey: 'tasks.board.cardAction.retry', icon: 'rotate-ccw', variant: 'cta', run: (cb, task) => cb.onMarkReady(task) },
    menu: [MENU_OPEN_NOTE, MENU_ARCHIVE],
  },
};

const FALLBACK_CARD_ACTIONS: CardActionModel = { primary: null, menu: [MENU_OPEN_NOTE] };

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
  // The single open ⋯ overflow popover (only one card menu is open at a time).
  // Tracked so a full re-render or a removed card tears it down — the popover is
  // portaled onto document.body, so it would otherwise leak a detached node and
  // its scroll/resize/click listeners across renders.
  private openPopover: PortalPopover | null = null;

  render(container: HTMLElement, state: AgentBoardRenderState, callbacks: AgentBoardRenderCallbacks): void {
    this.callbacks = callbacks;
    this.closePopover();
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
    refs.card.className = `claudian-agent-board-card claudian-agent-board-card--${status}${live ? ' claudian-agent-board-card--live-actions' : ''}`;

    // Rebuild the cluster for the new status. A patch may cross live/non-live or
    // change which primary/menu applies; rebuilding (rather than mutating in
    // place) keeps the action seam in sync. Any open ⋯ popover this card owned
    // is closed first so its portaled node + listeners don't outlive its trigger.
    this.closePopover();
    refs.actions.remove();
    refs.actions = this.insertCardActions(refs.card, refs.statusDot, task, live);

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
    // A removed card may own the open ⋯ popover; tear it down so the portaled
    // node + its listeners don't outlive the card they acted on.
    this.closePopover();
    refs.card.remove();
    this.cardRefs.delete(taskId);
  }

  /** Tear down the open ⋯ overflow popover (portaled on document.body), if any. */
  private closePopover(): void {
    this.openPopover?.close();
    this.openPopover = null;
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
    const live = LIVE_STATUSES.has(status);
    const card = parent.createDiv({
      // `--live-actions` keeps the title's right padding reserved so the
      // always-visible cluster on live cards never overlaps the title text.
      cls: `claudian-agent-board-card claudian-agent-board-card--${status}${live ? ' claudian-agent-board-card--live-actions' : ''}`,
    });

    const titleRow = card.createDiv({ cls: 'claudian-agent-board-card-title-row' });
    const statusDot = titleRow.createSpan({ cls: 'claudian-agent-board-card-status-dot' });
    this.applyStatusDot(statusDot, status);
    titleRow.createDiv({ cls: 'claudian-agent-board-card-title', text: task.frontmatter.title });

    // Hover action cluster: floats over the card's top-right (absolute), so it
    // reserves no layout width — titles keep their full width. Always-visible on
    // live cards; reveal-on-hover/focus otherwise (CSS-gated).
    const actions = this.renderCardActions(card, task, live);

    this.renderMetaRow(card, task);

    // The footer is always built (so its progress + assignee patch seams stay
    // live across status changes) but hidden while the reply surface is shown.
    const showReply = status === 'needs_input' || status === 'needs_approval';
    const { footer, assignee: assigneeSlot } = this.renderFooter(card, task);
    if (showReply) footer.addClass('is-hidden');

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
    const live = LIVE_STATUSES.has(status) ? ' claudian-agent-board-card-status-dot--live' : '';
    dot.className = `claudian-agent-board-card-status-dot claudian-agent-board-card-status-dot--${status}${live}`;
    const label = DEFAULT_LANE_TITLES[status];
    dot.setAttribute('aria-label', label);
    dot.setAttribute('title', label);
  }

  /** Meta row: provider/model (truncated) on the left, priority bars + label on the right. */
  private renderMetaRow(card: HTMLElement, task: TaskSpec): void {
    const meta = card.createDiv({ cls: 'claudian-agent-board-card-meta' });
    meta.createSpan({
      cls: 'claudian-agent-board-card-meta-engine',
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
      cls: `claudian-agent-board-card-priority claudian-agent-board-card-priority--${meta.modifier}`,
    });
    const bars = prio.createSpan({ cls: 'claudian-agent-board-card-priority-bars' });
    bars.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= PRIORITY_TOTAL_BARS; i++) {
      const filled = i <= meta.bars ? ' is-filled' : '';
      bars.createSpan({ cls: `claudian-agent-board-card-priority-bar${filled}` });
    }
    prio.createSpan({ cls: 'claudian-agent-board-card-priority-label', text: priority });
  }

  /**
   * Footer row: acceptance progress (track + done/total, green at 100%) on the
   * left, a reserved 20px assignee slot on the far right. When progress is
   * absent, a spacer keeps the slot right-aligned. The assignee slot stays an
   * empty placeholder in this slice (the persona slice fills it). Returns the
   * footer + assignee elements so both can be cached as patch seams.
   */
  private renderFooter(
    card: HTMLElement,
    task: TaskSpec,
  ): { footer: HTMLElement; assignee: HTMLElement } {
    const footer = card.createDiv({ cls: 'claudian-agent-board-card-footer' });
    const progress = parseAcceptanceProgress(task.sections.acceptanceCriteria);
    if (progress.total > 0) {
      const complete = progress.done >= progress.total;
      const progressEl = footer.createDiv({
        cls: `claudian-agent-board-card-progress${complete ? ' is-complete' : ''}`,
      });
      progressEl.setAttribute('title', `${progress.done}/${progress.total}`);
      const track = progressEl.createSpan({ cls: 'claudian-agent-board-card-progress-track' });
      const fill = track.createSpan({ cls: 'claudian-agent-board-card-progress-fill' });
      fill.style.width = `${(progress.done / progress.total) * 100}%`;
      progressEl.createSpan({
        cls: 'claudian-agent-board-card-progress-count',
        text: `${progress.done}/${progress.total}`,
      });
    } else {
      footer.createSpan({ cls: 'claudian-agent-board-card-footer-spacer' });
    }
    const assignee = footer.createSpan({ cls: 'claudian-agent-board-card-assignee' });
    return { footer, assignee };
  }

  /**
   * Hover action cluster: the single per-status primary button + the ⋯
   * overflow-menu trigger, floated over the card's top-right. The cluster
   * reserves no layout width (CSS `position: absolute`), so titles keep their
   * full width; it reveals on card hover/focus, and stays visible on live cards
   * (running / needs_input / needs_approval). `persistent` keys the always-on
   * styling for live cards. Every click routes through the supplied callbacks.
   */
  private renderCardActions(card: HTMLElement, task: TaskSpec, persistent: boolean): HTMLElement {
    const model = CARD_ACTIONS[task.frontmatter.status] ?? FALLBACK_CARD_ACTIONS;
    const cluster = card.createDiv({
      cls: `claudian-agent-board-card-actions${persistent ? ' claudian-agent-board-card-actions--persistent' : ''}`,
    });
    // The card opens the detail view on click; keep cluster interactions local.
    cluster.addEventListener('click', (event) => event.stopPropagation());

    if (model.primary) this.renderPrimaryAction(cluster, task, model.primary);
    this.renderOverflowMenu(cluster, task, model.menu);
    return cluster;
  }

  /**
   * Build the cluster and place it immediately after the title row (its DOM slot
   * on first render). The cluster is `position: absolute`, so order doesn't
   * affect its placement, but keeping the slot stable avoids surprising the
   * `cardRefs` consumers. Used by `patchCard` after removing the stale cluster.
   */
  private insertCardActions(
    card: HTMLElement,
    statusDot: HTMLElement,
    task: TaskSpec,
    persistent: boolean,
  ): HTMLElement {
    const cluster = this.renderCardActions(card, task, persistent);
    const titleRow = statusDot.parentElement;
    if (titleRow && titleRow.nextSibling) card.insertBefore(cluster, titleRow.nextSibling);
    return cluster;
  }

  private renderPrimaryAction(cluster: HTMLElement, task: TaskSpec, action: CardAction): void {
    const variant = action.variant ?? 'cta';
    const button = cluster.createEl('button', {
      cls: `claudian-agent-board-card-action-primary claudian-agent-board-card-action-primary--${variant}`,
      attr: { type: 'button' },
    });
    const label = t(action.labelKey);
    const icon = button.createSpan({ cls: 'claudian-agent-board-card-action-icon' });
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('data-icon', action.icon);
    setIcon(icon, action.icon);
    button.createSpan({ cls: 'claudian-agent-board-card-action-label', text: label });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const callbacks = this.callbacks;
      if (callbacks) action.run(callbacks, task);
    });
  }

  private renderOverflowMenu(cluster: HTMLElement, task: TaskSpec, menu: CardAction[]): void {
    const trigger = cluster.createEl('button', {
      cls: 'claudian-agent-board-card-action-more',
      attr: { type: 'button', 'aria-label': t('tasks.board.cardAction.moreActions'), 'aria-haspopup': 'menu' },
    });
    const glyph = trigger.createSpan({ cls: 'claudian-agent-board-card-action-icon' });
    glyph.setAttribute('aria-hidden', 'true');
    glyph.setAttribute('data-icon', 'more-horizontal');
    setIcon(glyph, 'more-horizontal');

    const items: PortalPopoverItem[] = menu.map((action) => ({
      label: t(action.labelKey),
      icon: action.icon,
      danger: action.danger,
      run: () => {
        const callbacks = this.callbacks;
        if (callbacks) action.run(callbacks, task);
      },
    }));

    const popover = new PortalPopover({
      trigger,
      items,
      menuClass: 'claudian-agent-board-card-menu',
      itemClass: 'claudian-agent-board-card-menu-item',
      itemIconClass: 'claudian-agent-board-card-menu-item-icon',
      itemDangerClass: 'claudian-agent-board-card-menu-item--danger',
      upClass: 'claudian-agent-board-card-menu--up',
    });

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      // Toggle: a second click on an already-open menu (this trigger's) closes it.
      if (popover.isOpen()) {
        this.closePopover();
        return;
      }
      // Only one card menu is open at a time — close any other before opening.
      this.closePopover();
      this.openPopover = popover;
      popover.open();
    });
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
      const question = pause?.question ?? task.frontmatter.pause_reason ?? t('tasks.board.card.reply.waitingForInput');
      this.renderPromptText(reply, question);
      const field = reply.createEl('input', {
        cls: 'claudian-agent-board-card-reply--field',
        type: 'text',
        placeholder: t('tasks.board.card.reply.inputPlaceholder'),
      });
      // Cap reply length so a pasted megabyte doesn't reach the runtime and
      // fail there with a cryptic error. 4000 chars is well below any provider
      // input cap but high enough for a real long-form reply.
      field.maxLength = REPLY_INPUT_MAX_LENGTH;
      if (pause?.defaultValue) field.value = pause.defaultValue;
      const actions = reply.createDiv({ cls: 'claudian-agent-board-card-reply--actions' });
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
          cls: 'claudian-agent-board-card-reply-risk',
          text: t('tasks.board.card.reply.risk', { risk: pause.risk }),
        });
      }
      const reason = reply.createEl('input', {
        cls: 'claudian-agent-board-card-reply--field',
        type: 'text',
        placeholder: t('tasks.board.card.reply.rejectReasonPlaceholder'),
      });
      reason.maxLength = REPLY_INPUT_MAX_LENGTH;
      const actions = reply.createDiv({ cls: 'claudian-agent-board-card-reply--actions' });
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
    metaEl.className = `claudian-agent-board-card-live-strip--meta claudian-stale-${tier}`;
    // Per-tier glyph + aria-label so color-blind users still get the freshness
    // signal. The bullet (●) is always present for the basic "live" indicator;
    // tier escalates to a warning/stop glyph for amber/red.
    const glyph = tier === 'green' ? '●' : tier === 'amber' ? '◐' : '◯';
    metaEl.setText(`${glyph} ${formatElapsed(payload.elapsedMs)} · attempt ${payload.attemptNumber}`);
    metaEl.setAttribute('aria-label', staleAriaLabel(tier, payload.heartbeatAgeMs));
    ledgerEl.setText(payload.lastLedger ?? 'starting…');
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
