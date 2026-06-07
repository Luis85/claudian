import type { TaskSpec } from '@/features/tasks/model/taskTypes';
import { WorkOrderActivityProvider } from '@/features/tasks/ui/WorkOrderActivityProvider';

const activeTask: TaskSpec = {
  path: 'Agent Board/tasks/task-1.md',
  frontmatter: {
    type: 'claudian-work-order',
    schema_version: 1,
    id: 'task-1',
    title: 'Task 1',
    status: 'running',
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
});
