import { TFile } from 'obsidian';

import type { TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';
import { WorkOrderActivityProvider } from '@/features/tasks/ui/WorkOrderActivityProvider';

function makeTask(id: string, status: TaskStatus = 'running'): TaskSpec {
  return {
    path: `Agent Board/tasks/${id}.md`,
    frontmatter: {
      type: 'specorator-work-order',
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

  describe('closable work-order tabs', () => {
    function closableHarness(overrides: Record<string, unknown> = {}) {
      const closeTab = jest.fn(async () => true);
      const listWorkOrderTabs = jest.fn(() => [
        { id: 'tab-1', title: 'Active WO', isStreaming: false },
        { id: 'tab-2', title: 'Finished WO', isStreaming: false },
      ]);
      const getTab = jest.fn((id: string) => (id === 'tab-1' || id === 'tab-2' ? {} : null));
      const manager = { getTab, switchToTab: jest.fn(), closeTab, listWorkOrderTabs, ...overrides };
      const plugin: any = {
        settings: { agentBoardWorkOrderFolder: 'Agent Board/tasks' },
        events: { on: jest.fn(() => jest.fn()) },
        getAllViews: jest.fn(() => [{ leaf: {}, getTabManager: () => manager }]),
        app: { vault: {}, workspace: { revealLeaf: jest.fn() } },
      };
      const provider = new WorkOrderActivityProvider(plugin, {
        indexTasks: jest.fn(async () => ({ tasks: [activeTask], invalidNotes: [] })),
      });
      return { provider, closeTab, listWorkOrderTabs };
    }

    it('lists open work-order tabs with no active run as closable (excluding active ones)', async () => {
      // activeTask backs sidepanel tab "tab-1", so only "tab-2" is closable.
      const { provider } = closableHarness();
      await provider.refresh();

      expect(provider.getSummary().closableTabs).toEqual([{ tabId: 'tab-2', title: 'Finished WO' }]);
    });

    it('force-closes the owning work-order tab to free the slot', async () => {
      const { provider, closeTab } = closableHarness();
      await provider.refresh();

      await provider.closeTab('tab-2');

      expect(closeTab).toHaveBeenCalledWith('tab-2', true);
    });

    it('reports no closable tabs when the tab manager cannot enumerate them', async () => {
      const { provider } = closableHarness({ listWorkOrderTabs: undefined });
      await provider.refresh();

      expect(provider.getSummary().closableTabs).toEqual([]);
    });

    it('never lists a streaming (live) work-order tab as closable', async () => {
      // Race: a run just started, the tab is streaming, but RunSession has not
      // yet persisted `running` + sidepanel_tab_id, so it is absent from the
      // active items. It must not be offered as a force-closable "finished" tab.
      const { provider } = closableHarness({
        listWorkOrderTabs: jest.fn(() => [{ id: 'tab-live', title: 'Just started', isStreaming: true }]),
      });
      await provider.refresh();

      expect(provider.getSummary().closableTabs).toEqual([]);
    });
  });

  it('persists field edits when the fallback detail modal saves', async () => {
    const noteContent = [
      '---',
      'type: specorator-work-order',
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
