import type { ResolvedBoardLayout, ResolvedLane } from '../config/boardConfigTypes';
import type { InvalidTaskNote, TaskSpec } from '../model/taskTypes';

export interface AgentBoardRenderCallbacks {
  onOpenDetail(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onAddWorkOrder(): void;
}

export interface AgentBoardRenderState {
  layout: ResolvedBoardLayout;
  invalidNotes: InvalidTaskNote[];
}

export class AgentBoardRenderer {
  render(container: HTMLElement, state: AgentBoardRenderState, callbacks: AgentBoardRenderCallbacks): void {
    container.empty();
    const root = container.createDiv({ cls: 'claudian-agent-board' });

    const header = root.createDiv({ cls: 'claudian-agent-board-header' });
    const addButton = header.createEl('button', { cls: 'mod-cta', text: 'Add work order' });
    addButton.addEventListener('click', () => callbacks.onAddWorkOrder());

    const lanesEl = root.createDiv({ cls: 'claudian-agent-board-lanes' });
    for (const lane of state.layout.lanes) {
      this.renderLane(lanesEl, lane, callbacks);
    }

    if (state.layout.errors.length > 0 || state.invalidNotes.length > 0) {
      this.renderErrors(root, state.layout.errors, state.invalidNotes);
    }
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
    const card = parent.createDiv({ cls: 'claudian-agent-board-card' });
    card.createDiv({ cls: 'claudian-agent-board-card-title', text: task.frontmatter.title });

    const meta = card.createDiv({ cls: 'claudian-agent-board-card-meta' });
    meta.createSpan({ text: `${task.frontmatter.provider ?? '—'} / ${task.frontmatter.model ?? '—'}` });
    meta.createSpan({ text: task.frontmatter.priority });

    card.addEventListener('click', () => callbacks.onOpenDetail(task));

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
