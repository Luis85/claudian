import { EventBus } from '@/core/events/EventBus';
import { CommitOnAcceptCoordinator } from '@/features/tasks/commit/CommitOnAcceptCoordinator';
import type { TaskEventMap } from '@/features/tasks/events';
import { TaskNoteStore } from '@/features/tasks/storage/TaskNoteStore';

const TASK_PATH = 'Agent Board/tasks/wo-1.md';

const TASK_CONTENT = `---
type: claudian-work-order
schema_version: 1
id: wo-1
title: Integration Task
status: done
priority: 2 - normal
created: 2026-06-04T10:00:00Z
updated: 2026-06-04T11:00:00Z
provider: claude
model: opus
conversation_id: conv-1
attempts: 1
---

## Objective
Verify integration

## Acceptance Criteria
- [x] All wired up
- [ ] Skipped item
`;

function setup(opts: { promptCommitOnAccept: boolean; dirtyCount: number; confirm: boolean; dontAskAgain: boolean }) {
  const events = new EventBus<TaskEventMap>();
  const settings: { promptCommitOnAccept: boolean } = { promptCommitOnAccept: opts.promptCommitOnAccept };
  const saveSettings = jest.fn(async () => undefined);
  const noteStore = new TaskNoteStore();
  const surface = { requestCommitTurn: jest.fn() as jest.Mock };
  surface.requestCommitTurn.mockResolvedValue(undefined);
  const openModal = jest.fn(async () => ({ confirmed: opts.confirm, dontAskAgain: opts.dontAskAgain }));
  const coordinator = new CommitOnAcceptCoordinator({
    events,
    loadTaskSpec: async (path) => noteStore.parse(path, TASK_CONTENT).task,
    getGitStatus: async () => ({ isRepo: true, dirtyCount: opts.dirtyCount }),
    isProviderGitEnabled: () => true,
    openModal,
    surface,
    readSettings: () => settings,
    saveSettings,
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    showNotice: jest.fn(),
  });
  coordinator.start();
  return { events, settings, saveSettings, surface, openModal, coordinator };
}

describe('Accept → commit flow (integration)', () => {
  it('drives the surface with a prompt scoped to the work-order on confirm', async () => {
    const h = setup({ promptCommitOnAccept: true, dirtyCount: 3, confirm: true, dontAskAgain: false });

    h.events.emit('task:status-changed', { taskId: 'wo-1', path: TASK_PATH, status: 'done' });
    await new Promise((r) => setImmediate(r));

    expect(h.openModal).toHaveBeenCalledWith({ taskTitle: 'Integration Task', dirtyCount: 3 });
    expect(h.surface.requestCommitTurn).toHaveBeenCalledTimes(1);
    const [, prompt] = h.surface.requestCommitTurn.mock.calls[0];
    expect(prompt).toContain('Work-Order: wo-1 — Integration Task');
    expect(prompt).toContain('Verify integration');
    expect(prompt).toContain('- All wired up');
    expect(prompt).not.toContain('- Skipped item');
  });

  it('does nothing when the toggle is off', async () => {
    const h = setup({ promptCommitOnAccept: false, dirtyCount: 3, confirm: true, dontAskAgain: false });

    h.events.emit('task:status-changed', { taskId: 'wo-1', path: TASK_PATH, status: 'done' });
    await new Promise((r) => setImmediate(r));

    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
  });

  it('persists the toggle off when the user picks "Don\'t ask again" + Skip', async () => {
    const h = setup({ promptCommitOnAccept: true, dirtyCount: 1, confirm: false, dontAskAgain: true });

    h.events.emit('task:status-changed', { taskId: 'wo-1', path: TASK_PATH, status: 'done' });
    await new Promise((r) => setImmediate(r));

    expect(h.settings.promptCommitOnAccept).toBe(false);
    expect(h.saveSettings).toHaveBeenCalled();
    expect(h.surface.requestCommitTurn).not.toHaveBeenCalled();
  });
});
