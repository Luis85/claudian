import { EventBus } from '@/core/events/EventBus';
import type { TaskEventMap } from '@/features/tasks/events';
import { CommitOnAcceptCoordinator } from '@/features/tasks/commit/CommitOnAcceptCoordinator';
import type { TaskSpec } from '@/features/tasks/model/taskTypes';

interface Harness {
  events: EventBus<TaskEventMap>;
  loadTaskSpec: jest.Mock<Promise<TaskSpec>, [string]>;
  getGitStatus: jest.Mock<Promise<{ isRepo: boolean; dirtyCount: number }>, []>;
  isProviderGitEnabled: jest.Mock<boolean, [string]>;
  openModal: jest.Mock<Promise<{ confirmed: boolean; dontAskAgain: boolean }>, [{ taskTitle: string; dirtyCount: number }]>;
  surface: { requestCommitTurn: jest.Mock<Promise<void>, [TaskSpec, string]> };
  settings: { promptCommitOnAccept: boolean };
  saveSettings: jest.Mock<Promise<void>, []>;
  logger: { debug: jest.Mock; warn: jest.Mock; error: jest.Mock };
  showNotice: jest.Mock<void, [string]>;
  coordinator: CommitOnAcceptCoordinator;
}

function makeTask(over: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: 'Agent Board/tasks/wo-1.md',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 'wo-1',
      title: 'Task A',
      status: 'done',
      priority: '2 - normal',
      created: '2026-06-04T10:00:00Z',
      updated: '2026-06-04T11:00:00Z',
      provider: 'claude',
      model: 'opus',
      conversation_id: 'conv-1',
      attempts: 1,
      ...over,
    },
    sections: { objective: 'Obj', acceptanceCriteria: '- [x] Yes', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  };
}

function makeHarness(initialSettings: Partial<Harness['settings']> = {}): Harness {
  const events = new EventBus<TaskEventMap>();
  const settings = { promptCommitOnAccept: true, ...initialSettings };
  const saveSettings = jest.fn(async () => undefined);
  const loadTaskSpec = jest.fn(async () => makeTask());
  const getGitStatus = jest.fn(async () => ({ isRepo: true, dirtyCount: 3 }));
  const isProviderGitEnabled = jest.fn(() => true);
  const openModal = jest.fn(async () => ({ confirmed: false, dontAskAgain: false }));
  const surface = { requestCommitTurn: jest.fn(async () => undefined) };
  const logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const showNotice = jest.fn();
  const coordinator = new CommitOnAcceptCoordinator({
    events,
    loadTaskSpec,
    getGitStatus,
    isProviderGitEnabled,
    openModal,
    surface,
    readSettings: () => settings,
    saveSettings,
    logger,
    showNotice,
  });
  coordinator.start();
  return { events, loadTaskSpec, getGitStatus, isProviderGitEnabled, openModal, surface, settings, saveSettings, logger, showNotice, coordinator };
}

describe('CommitOnAcceptCoordinator — silent-skip branches', () => {
  it('ignores non-done statuses', async () => {
    const h = makeHarness();
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'running' });
    await Promise.resolve();
    expect(h.loadTaskSpec).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('skips when promptCommitOnAccept is false', async () => {
    const h = makeHarness({ promptCommitOnAccept: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await Promise.resolve();
    expect(h.loadTaskSpec).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('skips silently when provider has opted out', async () => {
    const h = makeHarness();
    h.isProviderGitEnabled.mockReturnValueOnce(false);
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('skips silently when not a git repo', async () => {
    const h = makeHarness();
    h.getGitStatus.mockResolvedValueOnce({ isRepo: false, dirtyCount: 0 });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('skips silently when repo is clean', async () => {
    const h = makeHarness();
    h.getGitStatus.mockResolvedValueOnce({ isRepo: true, dirtyCount: 0 });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('warns and silently skips when the task spec fails to load', async () => {
    const h = makeHarness();
    h.loadTaskSpec.mockRejectedValueOnce(new Error('corrupt frontmatter'));
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.logger.warn).toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it('stop() removes the subscription', async () => {
    const h = makeHarness();
    h.coordinator.stop();
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.loadTaskSpec).not.toHaveBeenCalled();
  });
});
