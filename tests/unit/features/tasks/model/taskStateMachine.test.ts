import {
  assertTaskTransition,
  canTransitionTaskStatus,
  TASK_STATUSES,
} from '../../../../../src/features/tasks/model/taskStateMachine';
import type { TaskStatus } from '../../../../../src/features/tasks/model/taskTypes';

describe('TaskStateMachine', () => {
  it('lists the MVP statuses in lane order', () => {
    expect(TASK_STATUSES).toEqual([
      'inbox',
      'ready',
      'running',
      'needs_input',
      'needs_approval',
      'review',
      'needs_fix',
      'needs_handoff',
      'done',
      'failed',
      'canceled',
    ]);
  });

  it('prevents consumers from mutating the status order', () => {
    expect(Object.isFrozen(TASK_STATUSES)).toBe(true);
  });

  it.each<[TaskStatus, TaskStatus]>([
    ['inbox', 'ready'],
    ['ready', 'running'],
    ['needs_fix', 'running'],
    ['running', 'review'],
    ['running', 'failed'],
    ['running', 'canceled'],
    ['review', 'done'],
    ['review', 'needs_fix'],
    ['needs_fix', 'ready'],
    ['failed', 'ready'],
    ['done', 'inbox'],
    ['running', 'needs_input'],
    ['running', 'needs_approval'],
    ['running', 'needs_handoff'],
    ['needs_input', 'running'],
    ['needs_input', 'failed'],
    ['needs_input', 'canceled'],
    ['needs_approval', 'running'],
    ['needs_approval', 'failed'],
    ['needs_approval', 'canceled'],
    ['needs_handoff', 'review'],
    ['needs_handoff', 'failed'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(true);
    expect(() => assertTaskTransition(from, to)).not.toThrow();
  });

  it.each<[TaskStatus, TaskStatus]>([
    ['ready', 'review'],
    ['inbox', 'running'],
    ['done', 'running'],
    ['done', 'ready'],
    ['done', 'needs_fix'],
    ['canceled', 'running'],
    ['canceled', 'inbox'],
    ['failed', 'review'],
    ['ready', 'needs_handoff'],
    ['done', 'needs_handoff'],
    ['needs_handoff', 'running'],
    ['needs_handoff', 'inbox'],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(false);
    expect(() => assertTaskTransition(from, to)).toThrow(`Illegal task transition: ${from} -> ${to}`);
  });
});
