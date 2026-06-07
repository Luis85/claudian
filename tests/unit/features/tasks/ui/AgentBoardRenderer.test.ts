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
  type QueueToolbarState,
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
    hostsNewWorkOrders: id === 'inbox',
    definitionOfReady: [],
    definitionOfDone: [],
    isCatchAll: false,
    collapsible: false,
    collapsed: false,
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
    onMoveToInbox: jest.fn(),
    onContextMenu: jest.fn(),
    onToggleLaneCollapse: jest.fn(),
    onReply: jest.fn(),
    onApprove: jest.fn(),
    onReject: jest.fn(),
    onCancelPaused: jest.fn(),
    onSendToReview: jest.fn(),
    onMarkFailed: jest.fn(),
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

  it('exposes Review and Mark failed actions on needs_handoff cards', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('h', 'needs_handoff');
    renderer.render(host, makeState({ needs_handoff: [task] }), callbacks);
    findButton(host, 'Review')?.click();
    expect(callbacks.onSendToReview).toHaveBeenCalledWith(task);
    findButton(host, 'Mark failed')?.click();
    expect(callbacks.onMarkFailed).toHaveBeenCalledWith(task);
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

describe('AgentBoardRenderer — queue toolbar', () => {
  function renderQueue(host: HTMLElement, overrides: Partial<QueueToolbarState> = {}): void {
    new AgentBoardRenderer().render(
      host,
      {
        ...makeState({ ready: [makeTask('r', 'ready')] }),
        queue: {
          paused: false,
          halted: false,
          slotOccupied: 0,
          slotCapacity: 1,
          consecutiveFailures: 0,
          onToggle: () => {},
          ...overrides,
        },
      },
      makeCallbacks(),
    );
  }

  it('renders the toolbar toggle in running state by default', () => {
    const host = document.createElement('div');
    renderQueue(host);
    const toggle = host.querySelector('.claudian-agent-board-toolbar--queue-toggle');
    expect(toggle?.textContent).toBe('Pause queue');
    expect(
      host.querySelector('.claudian-agent-board-toolbar--queue-active-count')?.textContent,
    ).toContain('0/1');
  });

  it('renders failure counter when > 0', () => {
    const host = document.createElement('div');
    renderQueue(host, { consecutiveFailures: 2 });
    expect(
      host.querySelector('.claudian-agent-board-toolbar--queue-failure-count')?.textContent,
    ).toContain('2');
  });

  it('surfaces the halt reason inline and flips the toggle to run', () => {
    const host = document.createElement('div');
    renderQueue(host, { halted: true, haltReason: '3 consecutive failures · last: boom' });
    const toggle = host.querySelector('.claudian-agent-board-toolbar--queue-toggle');
    expect(toggle?.textContent).toBe('Run queue');
    expect(toggle?.classList.contains('claudian-agent-board-toolbar--queue-toggle-halted')).toBe(true);
    expect(
      host.querySelector('.claudian-agent-board-toolbar--queue-failure-count')?.textContent,
    ).toContain('boom');
  });

  it('invokes the toggle callback on click', () => {
    const host = document.createElement('div');
    let clicked = false;
    renderQueue(host, { onToggle: () => { clicked = true; } });
    (host.querySelector('.claudian-agent-board-toolbar--queue-toggle') as HTMLButtonElement)?.click();
    expect(clicked).toBe(true);
  });
});


describe('AgentBoardRenderer — merged board toolbar', () => {
  it('renders board actions and queue information in one toolbar row', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const state = makeState({ ready: [makeTask('r', 'ready')] });

    renderer.render(host, {
      ...state,
      queue: {
        paused: true,
        halted: false,
        slotOccupied: 0,
        slotCapacity: 1,
        consecutiveFailures: 0,
        onToggle: () => {},
      },
    }, makeCallbacks());

    const toolbars = host.querySelectorAll('.claudian-agent-board-toolbar');
    expect(toolbars).toHaveLength(1);
    expect(toolbars[0].querySelector('.claudian-agent-board-toolbar-actions')?.textContent).toContain('Add work order');
    expect(toolbars[0].querySelector('.claudian-agent-board-toolbar-actions')?.textContent).toContain('Run queue');
    expect(toolbars[0].querySelector('.claudian-agent-board-toolbar-info')?.textContent).toContain('Work-order tabs');
    expect(host.querySelector('.claudian-agent-board-header')).toBeNull();
  });
});

function buttonTexts(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('button')).map((btn) => btn.textContent ?? '');
}

describe('AgentBoardRenderer — recovery actions', () => {
  it('renders Back to inbox on ready cards', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
    expect(buttonTexts(host)).toContain('Back to inbox');
  });

  it('renders Retry and Back to inbox on failed cards', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ failed: [makeTask('f', 'failed')] }), makeCallbacks());
    expect(buttonTexts(host)).toEqual(expect.arrayContaining(['Retry', 'Back to inbox']));
  });

  it('invokes onMoveToInbox from Back to inbox', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('r', 'ready');
    renderer.render(host, makeState({ ready: [task] }), callbacks);
    const button = Array.from(host.querySelectorAll('button')).find((btn) => btn.textContent === 'Back to inbox');
    button?.click();
    expect(callbacks.onMoveToInbox).toHaveBeenCalledWith(task);
  });

  // A live paused run (needs_input / needs_approval) still holds its queue slot
  // via the pending coordinator.run(); a bare status transition from a generic
  // recovery button would strand that session and leak the slot. Those states are
  // driven solely by their reply surface (Send / Approve / Reject / Stop).
  it.each<TaskStatus>(['needs_input', 'needs_approval'])(
    'omits generic recovery actions for live %s cards but keeps the reply surface',
    (status) => {
      const renderer = new AgentBoardRenderer();
      const host = document.createElement('div');
      renderer.render(host, makeState({ live: [makeTask('p', status)] }), makeCallbacks());
      const texts = buttonTexts(host);
      expect(texts).not.toContain('Back to inbox');
      expect(texts).not.toContain('Resume');
      expect(host.querySelector('.claudian-agent-board-card-reply')).not.toBeNull();
    },
  );

  it('still offers Back to inbox once a stopped run settles to canceled', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ canceled: [makeTask('c', 'canceled')] }), makeCallbacks());
    expect(buttonTexts(host)).toContain('Back to inbox');
  });
});

describe('AgentBoardRenderer — skip chip', () => {
  it('renders the chip with reason text when reason is set', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    let acked = false;
    renderer.renderSkipChip(host, {
      reason: "provider 'codex' is disabled",
      onAck: () => {
        acked = true;
      },
    });
    const chip = host.querySelector('.claudian-agent-board-card-skip-chip');
    expect(chip?.textContent).toContain("provider 'codex' is disabled");
    (chip as HTMLElement)?.click();
    expect(acked).toBe(true);
  });

  it('renders nothing when reason is null', () => {
    const host = document.createElement('div');
    const renderer = new AgentBoardRenderer();
    renderer.renderSkipChip(host, { reason: null, onAck: () => {} });
    expect(host.querySelector('.claudian-agent-board-card-skip-chip')).toBeNull();
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

describe('AgentBoardRenderer — collapsible lanes', () => {
  function makeCollapsibleLane(collapsed: boolean): ResolvedLane {
    return {
      id: 'done',
      title: 'Done',
      tasks: [makeTask('t1', 'done')],
      hostsNewWorkOrders: false,
      definitionOfReady: [],
      definitionOfDone: [],
      isCatchAll: false,
      collapsible: true,
      collapsed,
    };
  }

  function stateWith(lane: ResolvedLane): AgentBoardRenderState {
    return {
      layout: { lanes: [lane], errors: [] },
      invalidNotes: [],
      slots: { used: 0, max: 1 },
    };
  }

  it('renders a chevron button on expanded collapsible lanes', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    renderer.render(host, stateWith(makeCollapsibleLane(false)), callbacks);
    const chevron = host.querySelector('.claudian-agent-board-lane-collapse-toggle') as HTMLButtonElement | null;
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute('aria-label')).toBe('Collapse lane');
    chevron?.click();
    expect(callbacks.onToggleLaneCollapse).toHaveBeenCalledWith('done');
  });

  it('omits the chevron on non-collapsible lanes', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ done: [makeTask('d', 'done')] }), makeCallbacks());
    expect(host.querySelector('.claudian-agent-board-lane-collapse-toggle')).toBeNull();
  });

  it('renders a strip with rotated title and count when collapsed; click expands', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    renderer.render(host, stateWith(makeCollapsibleLane(true)), callbacks);
    const strip = host.querySelector('.claudian-agent-board-lane--collapsed') as HTMLElement | null;
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute('role')).toBe('button');
    expect(strip?.getAttribute('aria-expanded')).toBe('false');
    expect(strip?.getAttribute('aria-label')).toBe('Expand lane Done');
    // Cards must not render inside the collapsed strip — the count badge speaks for them.
    expect(host.querySelector('.claudian-agent-board-card')).toBeNull();
    const titleVertical = strip?.querySelector('.claudian-agent-board-lane-title-vertical');
    expect(titleVertical?.textContent).toBe('Done');
    const count = strip?.querySelector('.claudian-agent-board-lane-count');
    expect(count?.textContent).toBe('1');
    strip?.click();
    expect(callbacks.onToggleLaneCollapse).toHaveBeenCalledWith('done');
  });

  it('chevron click does not bubble to a card click', () => {
    // Stops propagation so a chevron click never opens the first card by accident.
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    renderer.render(host, stateWith(makeCollapsibleLane(false)), callbacks);
    const chevron = host.querySelector('.claudian-agent-board-lane-collapse-toggle') as HTMLButtonElement | null;
    chevron?.click();
    expect(callbacks.onOpenDetail).not.toHaveBeenCalled();
  });

  it('preserves Enter/Space keyboard activation and aria-expanded on the collapsed strip', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    renderer.render(host, stateWith(makeCollapsibleLane(true)), callbacks);
    const strip = host.querySelector('.claudian-agent-board-lane--collapsed') as HTMLElement;
    expect(strip.getAttribute('tabindex')).toBe('0');
    expect(strip.getAttribute('aria-expanded')).toBe('false');

    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    strip.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(callbacks.onToggleLaneCollapse).toHaveBeenCalledTimes(2);
    expect(callbacks.onToggleLaneCollapse).toHaveBeenCalledWith('done');
  });
});

describe('AgentBoardRenderer — borderless lane header', () => {
  it('renders a lane header with the title and a count pill, with no lane frame/border class', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('a', 'ready'), makeTask('b', 'ready')] }), makeCallbacks());

    const header = host.querySelector('.claudian-agent-board-lane-header');
    expect(header).not.toBeNull();
    expect(header?.querySelector('.claudian-agent-board-lane-title')?.textContent).toBe('ready');

    const pill = host.querySelector('.claudian-agent-board-lane-count');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('2');
  });

  it('keeps the lane title as the source text (uppercasing is left to CSS)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ inbox: [makeTask('a', 'inbox')] }), makeCallbacks());
    // Source text is the lane title verbatim; text-transform handles the visual case.
    expect(host.querySelector('.claudian-agent-board-lane-title')?.textContent).toBe('inbox');
  });
});

describe('AgentBoardRenderer — Inbox add-work-order row', () => {
  function addRow(host: HTMLElement): HTMLButtonElement | null {
    return host.querySelector('.claudian-agent-board-lane-add') as HTMLButtonElement | null;
  }

  it('renders a dashed add-work-order row only in the Inbox lane', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(
      host,
      makeState({ inbox: [makeTask('a', 'inbox')], ready: [makeTask('b', 'ready')], done: [makeTask('c', 'done')] }),
      makeCallbacks(),
    );

    const inboxLane = host.querySelectorAll('.claudian-agent-board-lane')[0];
    expect(inboxLane.querySelector('.claudian-agent-board-lane-add')).not.toBeNull();
    // Exactly one add row across the whole board.
    expect(host.querySelectorAll('.claudian-agent-board-lane-add')).toHaveLength(1);
  });

  it('renders the add row even when the Inbox lane has no tasks', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ inbox: [] }), makeCallbacks());
    expect(addRow(host)).not.toBeNull();
  });

  it('does not render the add row in non-Inbox lanes', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('a', 'ready')], done: [makeTask('b', 'done')] }), makeCallbacks());
    expect(addRow(host)).toBeNull();
  });

  it('renders the add row on whichever lane hosts new work orders (id != "inbox")', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    // A custom board that remaps the inbox status onto a differently-id'd lane;
    // the resolver flags it as the new-work-order host.
    const lane: ResolvedLane = {
      id: 'triage',
      title: 'Triage',
      tasks: [makeTask('a', 'inbox')],
      hostsNewWorkOrders: true,
      definitionOfReady: [],
      definitionOfDone: [],
      isCatchAll: false,
      collapsible: false,
      collapsed: false,
    };
    const state: AgentBoardRenderState = {
      layout: { lanes: [lane], errors: [] },
      invalidNotes: [],
      slots: { used: 0, max: 4 },
    };
    renderer.render(host, state, makeCallbacks());
    expect(addRow(host)).not.toBeNull();
  });

  it('is a real button (keyboard-operable) and triggers onAddWorkOrder on click', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    renderer.render(host, makeState({ inbox: [makeTask('a', 'inbox')] }), callbacks);

    const row = addRow(host);
    expect(row?.tagName).toBe('BUTTON');
    row?.click();
    expect(callbacks.onAddWorkOrder).toHaveBeenCalledTimes(1);
  });

  it('omits the add row when a collapsed lane happens to share the inbox id', () => {
    // A collapsed lane renders the vertical strip, not the expanded body, so no
    // add row should appear inside it.
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const lane: ResolvedLane = {
      id: 'inbox',
      title: 'Inbox',
      tasks: [makeTask('a', 'inbox')],
      hostsNewWorkOrders: true,
      definitionOfReady: [],
      definitionOfDone: [],
      isCatchAll: false,
      collapsible: true,
      collapsed: true,
    };
    renderer.render(
      host,
      { layout: { lanes: [lane], errors: [] }, invalidNotes: [], slots: { used: 0, max: 1 } },
      makeCallbacks(),
    );
    expect(host.querySelector('.claudian-agent-board-lane-add')).toBeNull();
  });
});
