import { DEFAULT_LANE_TITLES, type ResolvedBoardLayout, type ResolvedLane } from '../config/boardConfigTypes';
import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import { isRunnableTaskStatus } from '../model/taskStateMachine';
import type { InvalidTaskNote, TaskSpec } from '../model/taskTypes';

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
  /** Queue skip reason for a card, or null when the card is not skipped. */
  getSkipReason?: (task: TaskSpec) => string | null;
  /** Dismiss a card's queue skip chip. */
  onAckSkip?: (task: TaskSpec) => void;
  onContextMenu(task: TaskSpec, event: MouseEvent): void;
}

export interface AgentBoardRenderState {
  layout: ResolvedBoardLayout;
  invalidNotes: InvalidTaskNote[];
  slots: { used: number; max: number };
}

export interface QueueToolbarState {
  paused: boolean;
  halted: boolean;
  slotOccupied: number;
  slotCapacity: number;
  consecutiveFailures: number;
  onToggle: () => void;
}

export interface HaltBannerState {
  reason: string | null;
  onResume: () => void;
  onOpenFailed: () => void;
}

export interface SkipChipState {
  reason: string | null;
  onAck: () => void;
}

export class AgentBoardRenderer {
  render(container: HTMLElement, state: AgentBoardRenderState, callbacks: AgentBoardRenderCallbacks): void {
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

  // Queue surfaces render into their own hosts so AgentBoardView can mount and
  // refresh them independently of the lane grid above.
  renderToolbar(host: HTMLElement, state: QueueToolbarState): void {
    host.empty();
    const bar = host.createDiv({ cls: 'claudian-agent-board-toolbar' });

    const toggle = bar.createEl('button', {
      cls: 'claudian-agent-board-toolbar--queue-toggle',
      text: state.paused || state.halted ? '▶ Queue' : '⏸ Queue',
    });
    if (state.halted) toggle.addClass('claudian-agent-board-toolbar--queue-toggle-halted');
    toggle.addEventListener('click', () => state.onToggle());

    bar.createSpan({
      cls: 'claudian-agent-board-toolbar--queue-active-count',
      text: `${state.slotOccupied}/${state.slotCapacity} active`,
    });

    if (state.consecutiveFailures > 0) {
      bar.createSpan({
        cls: 'claudian-agent-board-toolbar--queue-failure-count',
        text: `· ${state.consecutiveFailures} failures`,
      });
    }
  }

  renderHaltBanner(host: HTMLElement, state: HaltBannerState): void {
    host.empty();
    if (!state.reason) return;
    const banner = host.createDiv({ cls: 'claudian-agent-board-banner-halt' });
    banner.createDiv({
      cls: 'claudian-agent-board-banner-halt-title',
      text: `⚠ Queue halted: ${state.reason}`,
    });
    const actions = banner.createDiv({ cls: 'claudian-agent-board-banner-halt--actions' });
    const resume = actions.createEl('button', {
      cls: 'claudian-agent-board-banner-halt--resume',
      text: 'Resume queue',
    });
    resume.addEventListener('click', () => state.onResume());
    const open = actions.createEl('button', {
      cls: 'claudian-agent-board-banner-halt--open-failed',
      text: 'Open failed cards',
    });
    open.addEventListener('click', () => state.onOpenFailed());
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
    const card = parent.createDiv({ cls: 'claudian-agent-board-card' });
    if (status === 'failed') card.addClass('claudian-agent-board-card--failed');
    else if (status === 'canceled') card.addClass('claudian-agent-board-card--canceled');

    const titleRow = card.createDiv({ cls: 'claudian-agent-board-card-title-row' });
    titleRow.createDiv({ cls: 'claudian-agent-board-card-title', text: task.frontmatter.title });
    titleRow.createSpan({
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

    card.addEventListener('click', () => callbacks.onOpenDetail(task));
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      callbacks.onContextMenu(task, event);
    });

    const actions = card.createDiv({ cls: 'claudian-agent-board-card-actions' });
    if (task.frontmatter.status === 'inbox') {
      this.renderAction(actions, 'Mark ready', () => callbacks.onMarkReady(task));
    }
    if (task.frontmatter.status === 'ready' || task.frontmatter.status === 'needs_fix') {
      this.renderAction(actions, 'Run', () => callbacks.onRun(task));
    }
    if (task.frontmatter.status === 'running') {
      this.renderAction(actions, 'Stop', () => callbacks.onStop(task));
    }
    if (task.frontmatter.status === 'review') {
      this.renderAction(actions, 'Accept', () => callbacks.onAccept(task));
      this.renderAction(actions, 'Rework', () => callbacks.onRework(task));
    }
    if (task.frontmatter.status === 'done') {
      this.renderAction(actions, 'Reopen', () => callbacks.onReopen(task));
    }

    const skipReason = callbacks.getSkipReason?.(task) ?? null;
    if (skipReason) {
      const chipHost = card.createDiv({ cls: 'claudian-agent-board-card-skip-host' });
      this.renderSkipChip(chipHost, { reason: skipReason, onAck: () => callbacks.onAckSkip?.(task) });
    }
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
