import { TFile } from 'obsidian';

import type { TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';
import { WorkOrderActivityProvider } from '@/features/tasks/ui/WorkOrderActivityProvider';

function makeTask(id: string, status: TaskStatus = 'running'): TaskSpec {
  return {
    path: `Agent Board/tasks/${id}.md`,
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id,
      title: `Task ${id}`,
      status,
      priority: '2 - normal',
      created: '2026-06-07T00:00:00.000Z',
      updated: '2026-06-07T00:00:00.000Z',
      attempts: 0,
      sidepanel_tab_id: 'tab-1',
    },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  };
}

const activeTask: TaskSpec = makeTask('task-1');

function harness(overrides: Record<string, unknown> = {}) {
  const switchToTab = jest.fn(async () => undefined);
  const openDetailModal = jest.fn();
  const revealLeaf = jest.fn(async () => undefined);
  const leaf = { id: 'leaf-1' };
  const plugin: any = {
    settings: { agentBoardWorkOrderFolder: 'Agent Board/tasks' },
    events: { on: jest.fn(() => jest.fn()) },
    getAllViews: jest.fn(() => [{ leaf, getTabManager: () => ({ getTab: jest.fn(() => ({})), switchToTab }) }]),
    app: { vault: {}, workspace: { revealLeaf } },
    ...overrides,
  };
  const provider = new WorkOrderActivityProvider(plugin, {
    indexTasks: jest.fn(async () => ({ tasks: [activeTask], invalidNotes: [] })),
    openDetailModal,
  });
  return { provider, switchToTab, openDetailModal, revealLeaf, leaf };
}

describe('WorkOrderActivityProvider', () => {
  it('refreshes and notifies subscribers', async () => {
    const { provider } = harness();
    const listener = jest.fn();
    provider.subscribe(listener);

    await provider.refresh();

    expect(provider.getSummary().items).toEqual([expect.objectContaining({ id: 'task-1' })]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ runningCount: 1 }));
  });

  it('switches to a live sidepanel tab before opening the modal', async () => {
    const { provider, switchToTab, openDetailModal } = harness();
    await provider.refresh();

    await provider.openItem('task-1');

    expect(switchToTab).toHaveBeenCalledWith('tab-1');
    expect(openDetailModal).not.toHaveBeenCalled();
  });

  it('reveals the owning workspace leaf before switching to its tab', async () => {
    const { provider, switchToTab, revealLeaf, leaf } = harness();
    await provider.refresh();

    await provider.openItem('task-1');

    expect(revealLeaf).toHaveBeenCalledWith(leaf);
    // Reveal must precede the tab switch so the split is focused first.
    expect(revealLeaf.mock.invocationCallOrder[0]).toBeLessThan(switchToTab.mock.invocationCallOrder[0]);
  });

  it('falls back to detail modal when no live tab is found', async () => {
    const { provider, openDetailModal } = harness({ getAllViews: jest.fn(() => []) });
    await provider.refresh();

    await provider.openItem('task-1');

    expect(openDetailModal).toHaveBeenCalledWith(activeTask);
  });

  it('returns an empty summary when the vault mock cannot enumerate markdown files', async () => {
    const plugin: any = {
      settings: { agentBoardWorkOrderFolder: 'Agent Board/tasks' },
      events: { on: jest.fn(() => jest.fn()) },
      getAllViews: jest.fn(() => []),
      app: { vault: {}, workspace: {} },
    };
    const provider = new WorkOrderActivityProvider(plugin);

    await provider.refresh();

    expect(provider.getSummary().items).toEqual([]);
  });

  it('ignores stale refresh results when a newer refresh has already published', async () => {
    const plugin: any = {
      settings: { agentBoardWorkOrderFolder: 'Agent Board/tasks' },
      events: { on: jest.fn(() => jest.fn()) },
      getAllViews: jest.fn(() => []),
      app: { vault: {}, workspace: {} },
    };
    const resolvers: Array<(model: any) => void> = [];
    const indexTasks = jest.fn(
      () =>
        new Promise<any>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const provider = new WorkOrderActivityProvider(plugin, { indexTasks });
    const listener = jest.fn();
    provider.subscribe(listener);
    listener.mockClear();

    const refreshA = provider.refresh();
    const refreshB = provider.refresh();

    // Newer refresh (B) publishes first with task-2.
    resolvers[1]({ tasks: [makeTask('task-2')], invalidNotes: [] });
    await refreshB;
    expect(provider.getSummary().items).toEqual([expect.objectContaining({ id: 'task-2' })]);

    // Older refresh (A) resolves later with stale task-1 — must not overwrite B.
    resolvers[0]({ tasks: [makeTask('task-1')], invalidNotes: [] });
    await refreshA;
    expect(provider.getSummary().items).toEqual([expect.objectContaining({ id: 'task-2' })]);

    // Subscribers should only have been notified once for the live state.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  describe('vault watching', () => {
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    function vaultHarness() {
      const handlers: Record<string, (file: { path: string }, oldPath?: string) => void> = {};
      const vault: any = {
        on: jest.fn((event: string, cb: (file: { path: string }, oldPath?: string) => void) => {
          handlers[event] = cb;
          return { event };
        }),
        offref: jest.fn(),
      };
      const indexTasks = jest.fn(async () => ({ tasks: [activeTask], invalidNotes: [] }));
      const plugin: any = {
        settings: { agentBoardWorkOrderFolder: 'Agent Board/tasks' },
        events: { on: jest.fn(() => jest.fn()) },
        getAllViews: jest.fn(() => []),
        app: { vault, workspace: {} },
      };
      const provider = new WorkOrderActivityProvider(plugin, { indexTasks });
      return { provider, vault, handlers, indexTasks };
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('refreshes (debounced) when a work-order note changes in the vault', async () => {
      const { provider, handlers, indexTasks } = vaultHarness();
      provider.start();
      await flush();
      indexTasks.mockClear();

      // A board action can rename + modify the same note in one tick; both land
      // inside the debounce window and collapse to a single re-index.
      handlers.modify({ path: 'Agent Board/tasks/task-1.md' });
      handlers.modify({ path: 'Agent Board/tasks/task-1.md' });
      jest.advanceTimersByTime(100);
      await flush();

      expect(indexTasks).toHaveBeenCalledTimes(1);
    });

    it('ignores vault changes outside the work-order folder', async () => {
      const { provider, handlers, indexTasks } = vaultHarness();
      provider.start();
      await flush();
      indexTasks.mockClear();

      handlers.modify({ path: 'Notes/unrelated.md' });
      jest.advanceTimersByTime(100);
      await flush();

      expect(indexTasks).not.toHaveBeenCalled();
    });

    it('refreshes when a work-order note is renamed out of the folder', async () => {
      const { provider, handlers, indexTasks } = vaultHarness();
      provider.start();
      await flush();
      indexTasks.mockClear();

      handlers.rename({ path: 'Notes/moved.md' }, 'Agent Board/tasks/task-1.md');
      jest.advanceTimersByTime(100);
      await flush();

      expect(indexTasks).toHaveBeenCalledTimes(1);
    });

    it('unregisters vault listeners on dispose', async () => {
      const { provider, vault } = vaultHarness();
      provider.start();
      await flush();

      provider.dispose();

      expect(vault.offref).toHaveBeenCalledTimes(4);
    });
  });

  it('persists field edits when the fallback detail modal saves', async () => {
    const noteContent = [
      '---',
      'type: claudian-work-order',
      'schema_version: 1',
      'id: task-1',
      'title: Task task-1',
      'status: needs_input',
      'priority: 2 - normal',
      'created: 2026-06-07T00:00:00.000Z',
      'updated: 2026-06-07T00:00:00.000Z',
      'attempts: 0',
      '---',
      'Body',
      '',
    ].join('\n');
    const file = new TFile();
    const process = jest.fn(async (_file: TFile, transform: (content: string) => string) => transform(noteContent));
    const plugin: any = {
      settings: { agentBoardWorkOrderFolder: 'Agent Board/tasks' },
      events: { on: jest.fn(() => jest.fn()) },
      getAllViews: jest.fn(() => []),
      app: {
        vault: { getAbstractFileByPath: jest.fn(() => file), process },
        workspace: {},
      },
    };
    const task = makeTask('task-1', 'needs_input');
    const provider = new WorkOrderActivityProvider(plugin, {
      indexTasks: jest.fn(async () => ({ tasks: [task], invalidNotes: [] })),
    });

    const callbacks = (provider as unknown as {
      buildDetailModalCallbacks: (target: TaskSpec) => { onSaveFields?: (t: TaskSpec, f: Record<string, unknown>) => Promise<void> | void };
    }).buildDetailModalCallbacks(task);

    expect(callbacks.onSaveFields).toBeDefined();
    await callbacks.onSaveFields?.(task, { title: 'Renamed' });

    expect(process).toHaveBeenCalledWith(file, expect.any(Function));
    const transform = process.mock.calls[0][1] as (content: string) => string;
    expect(transform(noteContent)).toContain('title: Renamed');
  });
});
