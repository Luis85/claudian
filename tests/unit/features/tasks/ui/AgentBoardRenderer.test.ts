/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import type {
  ResolvedBoardLayout,
  ResolvedLane,
} from '../../../../../src/features/tasks/config/boardConfigTypes';
import type { TaskSpec, TaskStatus } from '../../../../../src/features/tasks/model/taskTypes';
import {
  type AgentBoardRenderCallbacks,
  AgentBoardRenderer,
  type AgentBoardRenderState,
} from '../../../../../src/features/tasks/ui/AgentBoardRenderer';

function makeTask(id: string, status: TaskStatus): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id,
      title: `Task ${id}`,
      status,
      priority: '2 - normal',
      created: '2026-06-03T00:00:00Z',
      updated: '2026-06-03T00:00:00Z',
      attempts: 0,
    },
    sections: {
      objective: '',
      acceptanceCriteria: '',
      context: '',
      constraints: '',
      ledger: '',
      handoff: '',
    },
    body: '',
    raw: '',
  };
}

function makeLane(id: string, tasks: TaskSpec[]): ResolvedLane {
  return {
    id,
    title: id,
    tasks,
    definitionOfReady: [],
    definitionOfDone: [],
    isCatchAll: false,
  };
}

function makeState(tasksByLane: Record<string, TaskSpec[]>): AgentBoardRenderState {
  const lanes = Object.entries(tasksByLane).map(([id, tasks]) => makeLane(id, tasks));
  const layout: ResolvedBoardLayout = { lanes, errors: [] };
  return {
    layout,
    invalidNotes: [],
    slots: { used: 0, max: 4 },
  };
}

function makeCallbacks(): AgentBoardRenderCallbacks {
  return {
    onOpenDetail: jest.fn(),
    onRun: jest.fn(),
    onStop: jest.fn(),
    onAccept: jest.fn(),
    onRework: jest.fn(),
    onMarkReady: jest.fn(),
    onAddWorkOrder: jest.fn(),
    onRunNextReady: jest.fn(),
    onReopen: jest.fn(),
    onContextMenu: jest.fn(),
  };
}

function findRunNextButton(host: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(host.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((btn) => btn.textContent === 'Run next ready') ?? null;
}

describe('AgentBoardRenderer — "Run next ready" button visibility', () => {
  it('hides the button when no work orders are in ready or needs_fix status', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const state = makeState({
      inbox: [makeTask('a', 'inbox')],
      running: [makeTask('b', 'running')],
      done: [makeTask('c', 'done')],
    });

    renderer.render(host, state, makeCallbacks());

    expect(findRunNextButton(host)).toBeNull();
  });

  it('shows the button when at least one work order is in ready status', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const state = makeState({
      inbox: [makeTask('a', 'inbox')],
      ready: [makeTask('r', 'ready')],
    });

    renderer.render(host, state, makeCallbacks());

    const btn = findRunNextButton(host);
    expect(btn).not.toBeNull();
  });

  it('shows the button when board has only needs_fix tasks (no ready)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const state = makeState({
      needs_fix: [makeTask('nf', 'needs_fix')],
      done: [makeTask('d', 'done')],
    });

    renderer.render(host, state, makeCallbacks());

    expect(findRunNextButton(host)).not.toBeNull();
  });

  it('invokes onRunNextReady when the visible button is clicked', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const state = makeState({ ready: [makeTask('r', 'ready')] });

    renderer.render(host, state, callbacks);

    const btn = findRunNextButton(host);
    btn?.click();
    expect(callbacks.onRunNextReady).toHaveBeenCalledTimes(1);
  });
});

function findReopenButton(host: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(host.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((btn) => btn.textContent === 'Reopen') ?? null;
}

describe('AgentBoardRenderer — Reopen button on done cards', () => {
  it('renders Reopen button on done card', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const state = makeState({ done: [makeTask('d', 'done')] });

    renderer.render(host, state, makeCallbacks());

    expect(findReopenButton(host)).not.toBeNull();
  });

  it('does not render Reopen button on non-done cards', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const state = makeState({
      review: [makeTask('rv', 'review')],
      failed: [makeTask('f', 'failed')],
      canceled: [makeTask('c', 'canceled')],
    });

    renderer.render(host, state, makeCallbacks());

    expect(findReopenButton(host)).toBeNull();
  });

  it('invokes onReopen when Reopen button is clicked on a done card', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const doneTask = makeTask('d', 'done');
    const state = makeState({ done: [doneTask] });

    renderer.render(host, state, callbacks);

    findReopenButton(host)?.click();
    expect(callbacks.onReopen).toHaveBeenCalledWith(doneTask);
  });
});

function findFirstCard(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.claudian-agent-board-card') as HTMLElement | null;
}

describe('AgentBoardRenderer — contextmenu listener', () => {
  function makeCallbacksWithCtxMenu() {
    return { ...makeCallbacks(), onContextMenu: jest.fn() };
  }

  it('invokes onContextMenu with the task and the event when a card is right-clicked', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacksWithCtxMenu();
    const task = makeTask('r', 'ready');
    const state = makeState({ ready: [task] });

    renderer.render(host, state, callbacks);

    const card = findFirstCard(host);
    expect(card).not.toBeNull();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    card!.dispatchEvent(event);

    expect(callbacks.onContextMenu).toHaveBeenCalledTimes(1);
    expect(callbacks.onContextMenu).toHaveBeenCalledWith(task, event);
  });

  it('calls preventDefault on the contextmenu event', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacksWithCtxMenu();
    const state = makeState({ ready: [makeTask('r', 'ready')] });

    renderer.render(host, state, callbacks);

    const card = findFirstCard(host);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefault = jest.spyOn(event, 'preventDefault');
    card!.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
  });

  it('left-click still invokes onOpenDetail (additive contextmenu does not break click)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacksWithCtxMenu();
    const task = makeTask('r', 'ready');
    const state = makeState({ ready: [task] });

    renderer.render(host, state, callbacks);

    findFirstCard(host)!.click();

    expect(callbacks.onOpenDetail).toHaveBeenCalledWith(task);
    expect(callbacks.onContextMenu).not.toHaveBeenCalled();
  });
});
