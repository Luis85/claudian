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
  const plugin: any = {
    settings: { agentBoardWorkOrderFolder: 'Agent Board/tasks' },
    events: { on: jest.fn(() => jest.fn()) },
    getAllViews: jest.fn(() => [{ getTabManager: () => ({ getTab: jest.fn(() => ({})), switchToTab }) }]),
    app: { vault: {}, workspace: {} },
    ...overrides,
  };
  const provider = new WorkOrderActivityProvider(plugin, {
    indexTasks: jest.fn(async () => ({ tasks: [activeTask], invalidNotes: [] })),
    openDetailModal,
  });
  return { provider, switchToTab, openDetailModal };
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
