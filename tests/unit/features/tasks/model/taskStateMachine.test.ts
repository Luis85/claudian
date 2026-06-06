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
  ])('allows %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(true);
    expect(() => assertTaskTransition(from, to)).not.toThrow();
  });


  it.each<[TaskStatus, TaskStatus]>([
    ['ready', 'inbox'],
    ['needs_input', 'ready'],
    ['needs_input', 'inbox'],
    ['needs_approval', 'ready'],
    ['needs_approval', 'inbox'],
    ['review', 'inbox'],
    ['needs_fix', 'inbox'],
    ['failed', 'inbox'],
    ['canceled', 'ready'],
    ['canceled', 'inbox'],
  ])('allows recovery transition %s -> %s', (from, to) => {
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
    ['failed', 'review'],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(false);
    expect(() => assertTaskTransition(from, to)).toThrow(`Illegal task transition: ${from} -> ${to}`);
  });
});
