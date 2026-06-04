import { EventBus } from '@/core/events/EventBus';
import { CommitOnAcceptCoordinator } from '@/features/tasks/commit/CommitOnAcceptCoordinator';
import type { TaskEventMap } from '@/features/tasks/events';
import type { TaskSpec } from '@/features/tasks/model/taskTypes';

interface Harness {
  events: EventBus<TaskEventMap>;
  loadTaskSpec: jest.Mock;
  getGitStatus: jest.Mock;
  isProviderGitEnabled: jest.Mock;
  openModal: jest.Mock;
  surface: { requestCommitTurn: jest.Mock };
  settings: { promptCommitOnAccept: boolean };
  saveSettings: jest.Mock;
  logger: { debug: jest.Mock; warn: jest.Mock; error: jest.Mock };
  showNotice: jest.Mock;
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

  it('skips silently when work order has no provider', async () => {
    const h = makeHarness();
    h.loadTaskSpec.mockResolvedValueOnce(makeTask({ provider: undefined }));
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
  });

  it('skips silently when work order has no model', async () => {
    const h = makeHarness();
    h.loadTaskSpec.mockResolvedValueOnce(makeTask({ model: undefined }));
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
  });

  it('stop() removes the subscription', async () => {
    const h = makeHarness();
    h.coordinator.stop();
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'p', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.loadTaskSpec).not.toHaveBeenCalled();
  });
});

describe('CommitOnAcceptCoordinator — happy path and post-modal branches', () => {
  it('opens the modal with the work-order title and dirty count', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).toHaveBeenCalledWith({ taskTitle: 'Task A', dirtyCount: 3 });
  });

  it('forwards the built prompt to the surface on confirm', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.surface.requestCommitTurn).toHaveBeenCalledTimes(1);
    const [, prompt] = h.surface.requestCommitTurn.mock.calls[0];
    expect(prompt).toContain('Work-Order: wo-1 — Task A');
  });

  it('does not call the surface when the user skips without dontAskAgain', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: false, dontAskAgain: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
    expect(h.saveSettings).not.toHaveBeenCalled();
  });

  it('writes settings off and skips surface when user skips with dontAskAgain', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: false, dontAskAgain: true });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.settings.promptCommitOnAccept).toBe(false);
    expect(h.saveSettings).toHaveBeenCalled();
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
  });

  it('shows a Notice and logs error when surface rejects', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    h.surface.requestCommitTurn.mockRejectedValueOnce(new Error('boom'));
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.logger.error).toHaveBeenCalled();
    expect(h.showNotice).toHaveBeenCalledWith(expect.stringMatching(/Commit prompt failed/));
  });

  it('shows a Notice when settings save fails on dontAskAgain', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValueOnce({ confirmed: false, dontAskAgain: true });
    h.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.logger.warn).toHaveBeenCalled();
    expect(h.showNotice).toHaveBeenCalledWith(expect.stringMatching(/Failed to save preference/));
  });

  it('handles two rapid accepts as two independent flows', async () => {
    const h = makeHarness();
    h.openModal.mockResolvedValue({ confirmed: true, dontAskAgain: false });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    h.events.emit('task:status-changed', { taskId: 'wo-1', path: 'Agent Board/tasks/wo-1.md', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(h.openModal).toHaveBeenCalledTimes(2);
    expect(h.surface.requestCommitTurn).toHaveBeenCalledTimes(2);
  });
});
