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
  onOpenDetail(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
}

export interface AgentBoardRenderState {
  model: TaskBoardModel;
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
      this.renderLane(lanesEl, status, laneTasks, callbacks);
    }

    if (state.model.invalidNotes.length > 0) {
      this.renderErrors(root, state.model.invalidNotes);
    }
  }

  private renderLane(
    parent: HTMLElement,
    status: TaskStatus,
    tasks: TaskSpec[],
    callbacks: AgentBoardRenderCallbacks,
  ): void {
    const lane = parent.createDiv({ cls: 'claudian-agent-board-lane' });
    const header = lane.createDiv({ cls: 'claudian-agent-board-lane-header' });
    header.createSpan({ text: LANE_TITLES[status] });
    header.createSpan({ cls: 'claudian-agent-board-lane-count', text: String(tasks.length) });
    for (const task of tasks) {
      this.renderCard(lane, task, callbacks);
    }
  }

  private renderCard(
    parent: HTMLElement,
    task: TaskSpec,
    callbacks: AgentBoardRenderCallbacks,
  ): void {
    const card = parent.createDiv({ cls: 'claudian-agent-board-card' });

    card.createDiv({ cls: 'claudian-agent-board-card-title', text: task.frontmatter.title });

    const meta = card.createDiv({ cls: 'claudian-agent-board-card-meta' });
    meta.createSpan({ text: `${task.frontmatter.provider ?? '—'} / ${task.frontmatter.model ?? '—'}` });
    meta.createSpan({ text: task.frontmatter.priority });

    card.addEventListener('click', () => callbacks.onOpenDetail(task));

    const actions = card.createDiv({ cls: 'claudian-agent-board-card-actions' });
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

  private renderErrors(parent: HTMLElement, invalidNotes: InvalidTaskNote[]): void {
    const errors = parent.createDiv({ cls: 'claudian-agent-board-errors' });
    errors.createEl('h4', { text: 'Skipped notes' });
    for (const note of invalidNotes) {
      errors.createDiv({ text: `${note.path}: ${note.error}` });
    }
  }
}
