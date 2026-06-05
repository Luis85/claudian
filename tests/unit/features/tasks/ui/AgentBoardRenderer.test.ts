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
    onReply: jest.fn(),
    onApprove: jest.fn(),
    onReject: jest.fn(),
    onCancelPaused: jest.fn(),
  };
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement | null {
  return (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[]).find(
    (btn) => btn.textContent === label,
  ) ?? null;
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

describe('AgentBoardRenderer — live strip + paused reply', () => {
  it('paints a live strip for running tasks', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ running: [makeTask('a', 'running')] }), makeCallbacks());
    expect(host.querySelector('.claudian-agent-board-card-live-strip')).not.toBeNull();
  });

  it('does not paint a live strip for non-live statuses', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('a', 'ready')] }), makeCallbacks());
    expect(host.querySelector('.claudian-agent-board-card-live-strip')).toBeNull();
  });

  it('patchLiveStrip updates the last ledger line without rebuilding the card', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ running: [makeTask('a', 'running')] }), makeCallbacks());
    const card = host.querySelector('.claudian-agent-board-card');
    renderer.patchLiveStrip('a', { lastLedger: 'tool: Edit src/foo.ts', elapsedMs: 12_000, attemptNumber: 1, heartbeatAgeMs: 2_000 });
    const ledgerEl = host.querySelector('.claudian-agent-board-card-live-strip--ledger');
    expect(ledgerEl?.textContent).toBe('tool: Edit src/foo.ts');
    expect(host.querySelector('.claudian-agent-board-card')).toBe(card);
  });

  it('patchCard shows a needs_input reply box seeded with the default value', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'needs_input');
    renderer.render(host, makeState({ needs_input: [task] }), makeCallbacks());
    renderer.patchCard('a', task, { question: 'which env?', defaultValue: '.env.local' });
    const field = host.querySelector('.claudian-agent-board-card-reply--field') as HTMLInputElement | null;
    expect(host.querySelector('.claudian-agent-board-card-reply')).not.toBeNull();
    expect(field?.value).toBe('.env.local');
  });

  it('routes the reply through onReply when Send is clicked', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('a', 'needs_input');
    renderer.render(host, makeState({ needs_input: [task] }), callbacks);
    renderer.patchCard('a', task, { question: 'which env?' });
    const field = host.querySelector('.claudian-agent-board-card-reply--field') as HTMLInputElement;
    field.value = 'my answer';
    findButton(host, 'Send')?.click();
    expect(callbacks.onReply).toHaveBeenCalledWith(task, 'my answer');
  });

  it('routes approve and reject for needs_approval', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('a', 'needs_approval');
    renderer.render(host, makeState({ needs_approval: [task] }), callbacks);
    renderer.patchCard('a', task, { action: 'drop table', risk: 'high' });
    findButton(host, 'Approve')?.click();
    expect(callbacks.onApprove).toHaveBeenCalledWith(task);
    const reason = host.querySelector('.claudian-agent-board-card-reply--field') as HTMLInputElement;
    reason.value = 'too risky';
    findButton(host, 'Reject')?.click();
    expect(callbacks.onReject).toHaveBeenCalledWith(task, 'too risky');
  });

  it('patchCard swaps the status badge and actions in place', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'running');
    renderer.render(host, makeState({ running: [task] }), makeCallbacks());
    const card = host.querySelector('.claudian-agent-board-card');
    renderer.patchCard('a', makeTask('a', 'review'), null);
    expect(host.querySelector('.claudian-agent-board-card')).toBe(card);
    expect(host.querySelector('.claudian-agent-board-status-badge')?.textContent).toBe('Review');
    expect(findButton(host, 'Accept')).not.toBeNull();
  });
});
