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
    onArchive: jest.fn(),
    onOpenNote: jest.fn(),
    onOpenConversation: jest.fn(),
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

function findCardCluster(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.claudian-agent-board-card-actions') as HTMLElement | null;
}

function findClusterPrimary(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector('.claudian-agent-board-card-action-primary') as HTMLButtonElement | null;
}

function findClusterTrigger(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector('.claudian-agent-board-card-action-more') as HTMLButtonElement | null;
}

function openClusterMenu(host: HTMLElement): HTMLElement {
  const trigger = findClusterTrigger(host);
  if (!trigger) throw new Error('cluster ⋯ trigger not found');
  trigger.click();
  const menu = document.querySelector('.claudian-agent-board-card-menu') as HTMLElement | null;
  if (!menu) throw new Error('cluster overflow menu did not open');
  return menu;
}

function menuItemTexts(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent ?? '');
}

function findMenuItem(menu: HTMLElement, label: string): HTMLButtonElement | null {
  return (Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[]).find(
    (el) => el.textContent === label,
  ) ?? null;
}

afterEach(() => {
  // The portal popover mounts on document.body; ensure no detached menu leaks
  // across tests if a case forgets to close it.
  document.body.querySelectorAll('.claudian-agent-board-card-menu').forEach((el) => el.remove());
});

describe('AgentBoardRenderer — hover action cluster (per-status primary + ⋯ menu)', () => {
  it('renders an action cluster (primary + ⋯ trigger) on every card', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
    const cluster = findCardCluster(host);
    expect(cluster).not.toBeNull();
    expect(findClusterPrimary(host)).not.toBeNull();
    expect(findClusterTrigger(host)?.getAttribute('aria-label')).toBe('More actions');
  });

  it('inbox: primary Mark ready → onMarkReady; menu = Open note, Run now, Archive', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('i', 'inbox');
    renderer.render(host, makeState({ inbox: [task] }), callbacks);

    expect(findClusterPrimary(host)?.textContent).toContain('Mark ready');
    findClusterPrimary(host)?.click();
    expect(callbacks.onMarkReady).toHaveBeenCalledWith(task);

    const menu = openClusterMenu(host);
    expect(menuItemTexts(menu)).toEqual(['Open note', 'Run now', 'Archive']);
    findMenuItem(menu, 'Run now')?.click();
    expect(callbacks.onRun).toHaveBeenCalledWith(task);
  });

  it('ready: primary Run → onRun; menu = Open note, Back to inbox, Archive', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('r', 'ready');
    renderer.render(host, makeState({ ready: [task] }), callbacks);

    expect(findClusterPrimary(host)?.textContent).toContain('Run');
    findClusterPrimary(host)?.click();
    expect(callbacks.onRun).toHaveBeenCalledWith(task);

    const menu = openClusterMenu(host);
    expect(menuItemTexts(menu)).toEqual(['Open note', 'Back to inbox', 'Archive']);
    findMenuItem(menu, 'Back to inbox')?.click();
    expect(callbacks.onMoveToInbox).toHaveBeenCalledWith(task);
  });

  it('needs_fix: primary Run → onRun (mirrors ready)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('nf', 'needs_fix');
    renderer.render(host, makeState({ needs_fix: [task] }), callbacks);
    expect(findClusterPrimary(host)?.textContent).toContain('Run');
    findClusterPrimary(host)?.click();
    expect(callbacks.onRun).toHaveBeenCalledWith(task);
  });

  it('running: primary Stop (danger) → onStop; menu = Open note, Open conversation', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('rn', 'running');
    renderer.render(host, makeState({ running: [task] }), callbacks);

    const primary = findClusterPrimary(host);
    expect(primary?.textContent).toContain('Stop');
    expect(primary?.classList.contains('claudian-agent-board-card-action-primary--danger')).toBe(true);
    primary?.click();
    expect(callbacks.onStop).toHaveBeenCalledWith(task);

    const menu = openClusterMenu(host);
    expect(menuItemTexts(menu)).toEqual(['Open note', 'Open conversation']);
  });

  it.each<TaskStatus>(['needs_input', 'needs_approval'])(
    '%s: no primary; menu = Open note, Open conversation, Stop (Stop is destructive)',
    (status) => {
      const renderer = new AgentBoardRenderer();
      const host = document.createElement('div');
      const callbacks = makeCallbacks();
      const task = makeTask('p', status);
      renderer.render(host, makeState({ live: [task] }), callbacks);

      // No primary action — the reply surface owns the live controls.
      expect(findClusterPrimary(host)).toBeNull();

      const menu = openClusterMenu(host);
      expect(menuItemTexts(menu)).toEqual(['Open note', 'Open conversation', 'Stop']);
      const stop = findMenuItem(menu, 'Stop');
      expect(stop?.classList.contains('claudian-agent-board-card-menu-item--danger')).toBe(true);
      stop?.click();
      expect(callbacks.onStop).toHaveBeenCalledWith(task);
    },
  );

  it('review: primary Accept → onAccept; menu = Rework, Open note, Open conversation, Back to inbox', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('rv', 'review');
    renderer.render(host, makeState({ review: [task] }), callbacks);

    expect(findClusterPrimary(host)?.textContent).toContain('Accept');
    findClusterPrimary(host)?.click();
    expect(callbacks.onAccept).toHaveBeenCalledWith(task);

    const menu = openClusterMenu(host);
    expect(menuItemTexts(menu)).toEqual(['Rework', 'Open note', 'Open conversation', 'Back to inbox']);
    findMenuItem(menu, 'Rework')?.click();
    expect(callbacks.onRework).toHaveBeenCalledWith(task);
  });

  it('needs_handoff: primary Send to review → onSendToReview; menu = Mark failed (danger), Open note', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('nh', 'needs_handoff');
    renderer.render(host, makeState({ needs_handoff: [task] }), callbacks);

    expect(findClusterPrimary(host)?.textContent).toContain('Send to review');
    findClusterPrimary(host)?.click();
    expect(callbacks.onSendToReview).toHaveBeenCalledWith(task);

    const menu = openClusterMenu(host);
    expect(menuItemTexts(menu)).toEqual(['Mark failed', 'Open note']);
    const markFailed = findMenuItem(menu, 'Mark failed');
    expect(markFailed?.classList.contains('claudian-agent-board-card-menu-item--danger')).toBe(true);
    markFailed?.click();
    expect(callbacks.onMarkFailed).toHaveBeenCalledWith(task);
  });

  it('done: primary Reopen (ghost) → onReopen; menu = Open note, Archive (Archive destructive)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('d', 'done');
    renderer.render(host, makeState({ done: [task] }), callbacks);

    const primary = findClusterPrimary(host);
    expect(primary?.textContent).toContain('Reopen');
    expect(primary?.classList.contains('claudian-agent-board-card-action-primary--ghost')).toBe(true);
    primary?.click();
    expect(callbacks.onReopen).toHaveBeenCalledWith(task);

    const menu = openClusterMenu(host);
    expect(menuItemTexts(menu)).toEqual(['Open note', 'Archive']);
    const archive = findMenuItem(menu, 'Archive');
    expect(archive?.classList.contains('claudian-agent-board-card-menu-item--danger')).toBe(true);
    archive?.click();
    expect(callbacks.onArchive).toHaveBeenCalledWith(task);
  });

  it('failed: primary Retry → onMarkReady; menu = Open note, Archive', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('f', 'failed');
    renderer.render(host, makeState({ failed: [task] }), callbacks);

    expect(findClusterPrimary(host)?.textContent).toContain('Retry');
    findClusterPrimary(host)?.click();
    expect(callbacks.onMarkReady).toHaveBeenCalledWith(task);

    const menu = openClusterMenu(host);
    expect(menuItemTexts(menu)).toEqual(['Open note', 'Archive']);
  });

  it('canceled: primary Retry → onMarkReady (mirrors failed)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('c', 'canceled');
    renderer.render(host, makeState({ canceled: [task] }), callbacks);
    expect(findClusterPrimary(host)?.textContent).toContain('Retry');
    findClusterPrimary(host)?.click();
    expect(callbacks.onMarkReady).toHaveBeenCalledWith(task);
  });

  it('Open note / Open conversation menu items route to their callbacks', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    const task = makeTask('rn', 'running');
    renderer.render(host, makeState({ running: [task] }), callbacks);
    const menu = openClusterMenu(host);
    findMenuItem(menu, 'Open note')?.click();
    expect(callbacks.onOpenNote).toHaveBeenCalledWith(task);

    const menu2 = openClusterMenu(host);
    findMenuItem(menu2, 'Open conversation')?.click();
    expect(callbacks.onOpenConversation).toHaveBeenCalledWith(task);
  });

  it('primary and ⋯ clicks do not bubble to the card click (onOpenDetail)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacks();
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), callbacks);
    findClusterPrimary(host)?.click();
    findClusterTrigger(host)?.click();
    expect(callbacks.onOpenDetail).not.toHaveBeenCalled();
  });
});

describe('AgentBoardRenderer — live cards keep the cluster persistent', () => {
  it.each<TaskStatus>(['running', 'needs_input', 'needs_approval'])(
    '%s card marks the cluster persistent (always-visible) on the card',
    (status) => {
      const renderer = new AgentBoardRenderer();
      const host = document.createElement('div');
      renderer.render(host, makeState({ live: [makeTask('p', status)] }), makeCallbacks());
      const card = findFirstCard(host);
      const cluster = findCardCluster(host);
      expect(cluster?.classList.contains('claudian-agent-board-card-actions--persistent')).toBe(true);
      // The title row reserves right padding so the persistent buttons never
      // overlap the title text (CSS keys off this modifier on the card).
      expect(card?.classList.contains('claudian-agent-board-card--live-actions')).toBe(true);
    },
  );

  it('non-live cards do not mark the cluster persistent', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
    expect(findCardCluster(host)?.classList.contains('claudian-agent-board-card-actions--persistent')).toBe(false);
    expect(findFirstCard(host)?.classList.contains('claudian-agent-board-card--live-actions')).toBe(false);
  });
});

describe('AgentBoardRenderer — ⋯ overflow menu (portal-positioned popover)', () => {
  function stubGeometry(trigger: HTMLElement, rect: Partial<DOMRect>, innerHeight: number): void {
    trigger.getBoundingClientRect = (() => ({
      top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
      ...rect,
    })) as () => DOMRect;
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  }

  it('mounts the menu on document.body (a portal, NOT inside the lane scroll container)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
      const menu = openClusterMenu(host);
      expect(menu.getAttribute('role')).toBe('menu');
      // The portal lives directly under document.body, not nested in the renderer host.
      expect(menu.parentElement).toBe(document.body);
      expect(host.querySelector('.claudian-agent-board-card-menu')).toBeNull();
    } finally {
      host.remove();
    }
  });

  it('uses role=menu + role=menuitem and a leading icon span per item', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ inbox: [makeTask('i', 'inbox')] }), makeCallbacks());
    const menu = openClusterMenu(host);
    expect(menu.getAttribute('role')).toBe('menu');
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(3);
    items.forEach((item) => {
      expect(item.querySelector('.claudian-agent-board-card-menu-item-icon')).not.toBeNull();
    });
  });

  it('positions with fixed coordinates derived from the trigger rect (drops down with room below)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
    const trigger = findClusterTrigger(host)!;
    stubGeometry(trigger, { top: 100, bottom: 120, left: 200, right: 226 }, 800);
    trigger.click();
    const menu = document.querySelector('.claudian-agent-board-card-menu') as HTMLElement;
    // position: fixed comes from the menu CSS class; only the dynamic top/left are inline.
    expect(menu.classList.contains('claudian-agent-board-card-menu')).toBe(true);
    // Room below (bottom 120 + menu height < 800) → drops down just under the trigger.
    expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(120);
    expect(menu.classList.contains('claudian-agent-board-card-menu--up')).toBe(false);
  });

  it('flips upward when the menu would overflow the viewport bottom', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ review: [makeTask('rv', 'review')] }), makeCallbacks());
    const trigger = findClusterTrigger(host)!;
    // Trigger sits near the very bottom of a short viewport → no room below.
    stubGeometry(trigger, { top: 590, bottom: 598, left: 200, right: 226 }, 600);
    trigger.click();
    const menu = document.querySelector('.claudian-agent-board-card-menu') as HTMLElement;
    expect(menu.classList.contains('claudian-agent-board-card-menu--up')).toBe(true);
    // Dropped up: the menu's top is above the trigger's top.
    expect(parseFloat(menu.style.top)).toBeLessThan(590);
  });

  it('closes on outside-click (mousedown) and returns focus to the trigger', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
      const trigger = findClusterTrigger(host)!;
      trigger.click();
      expect(document.querySelector('.claudian-agent-board-card-menu')).not.toBeNull();
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(document.querySelector('.claudian-agent-board-card-menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      host.remove();
    }
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
      const trigger = findClusterTrigger(host)!;
      trigger.click();
      const menu = document.querySelector('.claudian-agent-board-card-menu') as HTMLElement;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.querySelector('.claudian-agent-board-card-menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      host.remove();
    }
  });

  it('closes on scroll (capture) and on resize', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());

    findClusterTrigger(host)!.click();
    expect(document.querySelector('.claudian-agent-board-card-menu')).not.toBeNull();
    window.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('.claudian-agent-board-card-menu')).toBeNull();

    findClusterTrigger(host)!.click();
    expect(document.querySelector('.claudian-agent-board-card-menu')).not.toBeNull();
    window.dispatchEvent(new Event('resize'));
    expect(document.querySelector('.claudian-agent-board-card-menu')).toBeNull();
  });

  it('clicking the ⋯ trigger again closes an open menu (toggle)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
    const trigger = findClusterTrigger(host)!;
    trigger.click();
    expect(document.querySelector('.claudian-agent-board-card-menu')).not.toBeNull();
    trigger.click();
    expect(document.querySelector('.claudian-agent-board-card-menu')).toBeNull();
  });

  it('a full re-render closes any open portal menu (no leaked detached popover)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
    findClusterTrigger(host)!.click();
    expect(document.querySelector('.claudian-agent-board-card-menu')).not.toBeNull();
    // Re-render (e.g. board refresh) must tear the portal down.
    renderer.render(host, makeState({ ready: [makeTask('r', 'ready')] }), makeCallbacks());
    expect(document.querySelector('.claudian-agent-board-card-menu')).toBeNull();
  });

  it('selecting a menu item closes the menu', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ done: [makeTask('d', 'done')] }), makeCallbacks());
    const menu = openClusterMenu(host);
    findMenuItem(menu, 'Open note')?.click();
    expect(document.querySelector('.claudian-agent-board-card-menu')).toBeNull();
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

  it('patchCard restores the footer (progress + assignee) when a paused card resumes', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'needs_input');
    task.sections.acceptanceCriteria = '- [x] one\n- [ ] two';
    renderer.render(host, makeState({ needs_input: [task] }), makeCallbacks());

    // Paused: footer is hidden (not destroyed), reply surface shown.
    const footer = host.querySelector('.claudian-agent-board-card-footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(footer.classList.contains('is-hidden')).toBe(true);
    expect(host.querySelector('.claudian-agent-board-card-reply')).not.toBeNull();

    // Resume to a non-reply status via patchCard (no full re-render): the footer
    // (same DOM node) comes back and the reply surface is removed.
    const resumed = makeTask('a', 'running');
    resumed.sections.acceptanceCriteria = '- [x] one\n- [ ] two';
    renderer.patchCard('a', resumed);
    expect(footer.classList.contains('is-hidden')).toBe(false);
    expect(host.querySelector('.claudian-agent-board-card-reply')).toBeNull();
    expect(host.querySelector('.claudian-agent-board-card-progress')).not.toBeNull();
    expect(host.querySelector('.claudian-agent-board-card-assignee')).not.toBeNull();
  });

  it('patchCard swaps the status dot color + aria-label in place (no full re-render)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'running');
    renderer.render(host, makeState({ running: [task] }), makeCallbacks());
    const card = host.querySelector('.claudian-agent-board-card');
    const dot = host.querySelector('.claudian-agent-board-card-status-dot') as HTMLElement;
    expect(dot.classList.contains('claudian-agent-board-card-status-dot--running')).toBe(true);
    renderer.patchCard('a', makeTask('a', 'review'), null);
    expect(host.querySelector('.claudian-agent-board-card')).toBe(card);
    expect(dot.classList.contains('claudian-agent-board-card-status-dot--running')).toBe(false);
    expect(dot.classList.contains('claudian-agent-board-card-status-dot--review')).toBe(true);
    expect(dot.getAttribute('aria-label')).toBe('Review');
  });

  it('patchCard removes the reply surface when leaving a live status', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'needs_input');
    renderer.render(host, makeState({ needs_input: [task] }), makeCallbacks());
    expect(host.querySelector('.claudian-agent-board-card-reply')).not.toBeNull();
    renderer.patchCard('a', makeTask('a', 'review'), null);
    expect(host.querySelector('.claudian-agent-board-card-reply')).toBeNull();
  });
});

describe('AgentBoardRenderer — card body (title dot / meta / footer)', () => {
  it('renders a status dot carrying the status color class + accessible status label', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ needs_approval: [makeTask('a', 'needs_approval')] }), makeCallbacks());
    const dot = host.querySelector('.claudian-agent-board-card-status-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.classList.contains('claudian-agent-board-card-status-dot--needs_approval')).toBe(true);
    // a11y: the dot announces the status (no visible text badge anymore).
    expect(dot.getAttribute('aria-label')).toBe('Needs approval');
    expect(dot.getAttribute('title')).toBe('Needs approval');
  });

  it('flags live statuses on the dot so CSS can pulse them', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ running: [makeTask('a', 'running')] }), makeCallbacks());
    const liveDot = host.querySelector('.claudian-agent-board-card-status-dot') as HTMLElement;
    expect(liveDot.classList.contains('claudian-agent-board-card-status-dot--live')).toBe(true);

    const host2 = document.createElement('div');
    new AgentBoardRenderer().render(host2, makeState({ ready: [makeTask('b', 'ready')] }), makeCallbacks());
    const staticDot = host2.querySelector('.claudian-agent-board-card-status-dot') as HTMLElement;
    expect(staticDot.classList.contains('claudian-agent-board-card-status-dot--live')).toBe(false);
  });

  it('no longer renders the old text status badge', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ ready: [makeTask('a', 'ready')] }), makeCallbacks());
    expect(host.querySelector('.claudian-agent-board-status-badge')).toBeNull();
  });

  it('renders provider/model with truncation classes on the meta engine cell', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'ready');
    task.frontmatter.provider = 'claude';
    task.frontmatter.model = 'sonnet';
    renderer.render(host, makeState({ ready: [task] }), makeCallbacks());
    const engine = host.querySelector('.claudian-agent-board-card-meta-engine') as HTMLElement;
    expect(engine).not.toBeNull();
    expect(engine.textContent).toContain('claude');
    expect(engine.textContent).toContain('sonnet');
  });

  it('renders three priority bars filled per level with the priority color class', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'ready');
    task.frontmatter.priority = '1 - high';
    renderer.render(host, makeState({ ready: [task] }), makeCallbacks());
    const prio = host.querySelector('.claudian-agent-board-card-priority') as HTMLElement;
    expect(prio).not.toBeNull();
    expect(prio.classList.contains('claudian-agent-board-card-priority--high')).toBe(true);
    const bars = prio.querySelectorAll('.claudian-agent-board-card-priority-bar');
    expect(bars).toHaveLength(3);
    // "1 - high" → 2 bars filled (low=1, normal=2, high=2? ascending: urgent=3, high=2, normal=2…)
    const filled = prio.querySelectorAll('.claudian-agent-board-card-priority-bar.is-filled');
    expect(filled.length).toBeGreaterThan(0);
    expect(prio.textContent).toContain('1 - high');
  });

  it('renders a legacy/unknown priority without crashing the board (falls back to normal)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('legacy', 'ready');
    // A legacy/hand-authored value outside the canonical priority set.
    (task.frontmatter as { priority: string }).priority = 'normal';
    expect(() => renderer.render(host, makeState({ ready: [task] }), makeCallbacks())).not.toThrow();
    const prio = host.querySelector('.claudian-agent-board-card-priority') as HTMLElement;
    expect(prio).not.toBeNull();
    // Falls back to the normal styling, but still shows the raw value as the label.
    expect(prio.classList.contains('claudian-agent-board-card-priority--normal')).toBe(true);
    expect(host.querySelector('.claudian-agent-board-card-priority-label')?.textContent).toBe('normal');
  });

  it('renders acceptance progress in the footer with done/total and a track', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'ready');
    task.sections.acceptanceCriteria = '- [x] one\n- [ ] two\n- [ ] three';
    renderer.render(host, makeState({ ready: [task] }), makeCallbacks());
    const footer = host.querySelector('.claudian-agent-board-card-footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(footer.querySelector('.claudian-agent-board-card-progress-track')).not.toBeNull();
    expect(footer.querySelector('.claudian-agent-board-card-progress-count')?.textContent).toBe('1/3');
  });

  it('marks the progress complete (green) when all acceptance criteria are checked', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'ready');
    task.sections.acceptanceCriteria = '- [x] one\n- [x] two';
    renderer.render(host, makeState({ ready: [task] }), makeCallbacks());
    const progress = host.querySelector('.claudian-agent-board-card-progress') as HTMLElement;
    expect(progress.classList.contains('is-complete')).toBe(true);
    expect(progress.querySelector('.claudian-agent-board-card-progress-count')?.textContent).toBe('2/2');
  });

  it('reserves a 20px assignee slot at the footer far right (empty placeholder this slice)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'ready');
    task.sections.acceptanceCriteria = '- [ ] one';
    renderer.render(host, makeState({ ready: [task] }), makeCallbacks());
    const footer = host.querySelector('.claudian-agent-board-card-footer') as HTMLElement;
    const slot = footer.querySelector('.claudian-agent-board-card-assignee') as HTMLElement;
    expect(slot).not.toBeNull();
    // Placeholder only — the persona slice fills it; no avatar rendered here.
    expect(slot.childElementCount).toBe(0);
    expect(slot.textContent).toBe('');
  });

  it('keeps a footer with a spacer + assignee slot when acceptance progress is absent', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    // No acceptance criteria → no progress; footer still renders so the slot stays right-aligned.
    renderer.render(host, makeState({ ready: [makeTask('a', 'ready')] }), makeCallbacks());
    const footer = host.querySelector('.claudian-agent-board-card-footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(footer.querySelector('.claudian-agent-board-card-progress')).toBeNull();
    expect(footer.querySelector('.claudian-agent-board-card-footer-spacer')).not.toBeNull();
    expect(footer.querySelector('.claudian-agent-board-card-assignee')).not.toBeNull();
  });

  it('hides the footer (kept in DOM as a patch seam) while a reply surface is shown', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const task = makeTask('a', 'needs_input');
    task.sections.acceptanceCriteria = '- [ ] one';
    renderer.render(host, makeState({ needs_input: [task] }), makeCallbacks());
    expect(host.querySelector('.claudian-agent-board-card-reply')).not.toBeNull();
    // The footer is hidden (not destroyed) so a resumed card keeps its progress
    // + assignee patch seams; `is-hidden` visually omits it.
    const footer = host.querySelector('.claudian-agent-board-card-footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(footer.classList.contains('is-hidden')).toBe(true);
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

describe('AgentBoardRenderer — recovery actions live in the hover cluster', () => {
  // The recovery actions restored by this slice: Retry is the in-card primary for
  // failed/canceled; Back to inbox is a ⋯ menu item (rendered in the portal on
  // document.body, not inline in the card body).
  it('renders Retry as the in-card primary for failed and canceled cards', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    renderer.render(host, makeState({ failed: [makeTask('f', 'failed')] }), makeCallbacks());
    expect(findClusterPrimary(host)?.textContent).toContain('Retry');

    const host2 = document.createElement('div');
    new AgentBoardRenderer().render(host2, makeState({ canceled: [makeTask('c', 'canceled')] }), makeCallbacks());
    expect(findClusterPrimary(host2)?.textContent).toContain('Retry');
  });

  // A live paused run (needs_input / needs_approval) keeps its reply surface (Send /
  // Approve / Reject / Stop) AND gains the persistent cluster ⋯ menu — the reply
  // surface and the cluster coexist on live cards.
  it.each<TaskStatus>(['needs_input', 'needs_approval'])(
    'keeps the reply surface AND the cluster ⋯ on live %s cards',
    (status) => {
      const renderer = new AgentBoardRenderer();
      const host = document.createElement('div');
      renderer.render(host, makeState({ live: [makeTask('p', status)] }), makeCallbacks());
      expect(host.querySelector('.claudian-agent-board-card-reply')).not.toBeNull();
      expect(findClusterTrigger(host)).not.toBeNull();
      // No in-card primary — the reply surface owns the live controls.
      expect(findClusterPrimary(host)).toBeNull();
    },
  );
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
