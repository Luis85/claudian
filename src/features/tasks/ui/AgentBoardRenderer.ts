import { TASK_STATUSES } from '../model/taskStateMachine';
import type { InvalidTaskNote, TaskBoardModel, TaskSpec, TaskStatus } from '../model/taskTypes';

const LANE_TITLES: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  ready: 'Ready',
  running: 'Running',
  needs_input: 'Needs input',
  needs_approval: 'Needs approval',
  review: 'Review',
  needs_fix: 'Needs fix',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
};

export interface AgentBoardRenderCallbacks {
  onOpen(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onSelect(task: TaskSpec): void;
}

export interface AgentBoardRenderState {
  model: TaskBoardModel;
  selectedPath: string | null;
}

export class AgentBoardRenderer {
  render(
    container: HTMLElement,
    state: AgentBoardRenderState,
    callbacks: AgentBoardRenderCallbacks,
  ): void {
    container.empty();
    const root = container.createDiv({ cls: 'claudian-agent-board' });

    const lanesEl = root.createDiv({ cls: 'claudian-agent-board-lanes' });
    for (const status of TASK_STATUSES) {
      const laneTasks = state.model.tasks.filter((task) => task.frontmatter.status === status);
      this.renderLane(lanesEl, status, laneTasks, state.selectedPath, callbacks);
    }

    const selected = state.model.tasks.find((task) => task.path === state.selectedPath) ?? null;
    this.renderDetail(root, selected);

    if (state.model.invalidNotes.length > 0) {
      this.renderErrors(root, state.model.invalidNotes);
    }
  }

  private renderLane(
    parent: HTMLElement,
    status: TaskStatus,
    tasks: TaskSpec[],
    selectedPath: string | null,
    callbacks: AgentBoardRenderCallbacks,
  ): void {
    const lane = parent.createDiv({ cls: 'claudian-agent-board-lane' });
    const header = lane.createDiv({ cls: 'claudian-agent-board-lane-header' });
    header.createSpan({ text: LANE_TITLES[status] });
    header.createSpan({ cls: 'claudian-agent-board-lane-count', text: String(tasks.length) });
    for (const task of tasks) {
      this.renderCard(lane, task, selectedPath, callbacks);
    }
  }

  private renderCard(
    parent: HTMLElement,
    task: TaskSpec,
    selectedPath: string | null,
    callbacks: AgentBoardRenderCallbacks,
  ): void {
    const card = parent.createDiv({ cls: 'claudian-agent-board-card' });
    if (task.path === selectedPath) card.addClass('is-selected');

    card.createDiv({ cls: 'claudian-agent-board-card-title', text: task.frontmatter.title });

    const meta = card.createDiv({ cls: 'claudian-agent-board-card-meta' });
    meta.createSpan({ text: `${task.frontmatter.provider ?? '—'} / ${task.frontmatter.model ?? '—'}` });
    meta.createSpan({ text: task.frontmatter.priority });

    card.addEventListener('click', () => callbacks.onSelect(task));

    const actions = card.createDiv({ cls: 'claudian-agent-board-card-actions' });
    this.renderAction(actions, 'Open', () => callbacks.onOpen(task));
    if (task.frontmatter.status === 'ready' || task.frontmatter.status === 'needs_fix') {
      this.renderAction(actions, 'Run', () => callbacks.onRun(task));
    }
    if (task.frontmatter.status === 'running') {
      this.renderAction(actions, 'Stop', () => callbacks.onStop(task));
    }
  }

  private renderAction(parent: HTMLElement, label: string, handler: () => void): void {
    const button = parent.createEl('button', { text: label });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
  }

  private renderDetail(parent: HTMLElement, task: TaskSpec | null): void {
    const detail = parent.createDiv({ cls: 'claudian-agent-board-detail' });
    if (!task) {
      detail.createEl('p', { text: 'Select a work order to see its details.' });
      return;
    }

    detail.createEl('h3', { text: task.frontmatter.title });
    this.renderDetailSection(detail, 'Objective', task.sections.objective);
    this.renderDetailSection(detail, 'Acceptance criteria', task.sections.acceptanceCriteria);
    this.renderDetailSection(detail, 'Run ledger', task.sections.ledger);
    this.renderDetailSection(detail, 'Handoff', task.sections.handoff);
  }

  private renderDetailSection(parent: HTMLElement, label: string, body: string): void {
    parent.createEl('h4', { text: label });
    parent.createEl('pre', { text: body.length > 0 ? body : '—' });
  }

  private renderErrors(parent: HTMLElement, invalidNotes: InvalidTaskNote[]): void {
    const errors = parent.createDiv({ cls: 'claudian-agent-board-errors' });
    errors.createEl('h4', { text: 'Skipped notes' });
    for (const note of invalidNotes) {
      errors.createDiv({ text: `${note.path}: ${note.error}` });
    }
  }
}
