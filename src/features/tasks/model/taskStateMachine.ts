import type { TaskStatus } from './taskTypes';

export const TASK_STATUSES = Object.freeze([
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
] as const satisfies readonly TaskStatus[]);

const transitionSet = (...statuses: TaskStatus[]): ReadonlySet<TaskStatus> => new Set(statuses);

const LEGAL_TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map<TaskStatus, ReadonlySet<TaskStatus>>([
  ['inbox', transitionSet('ready')],
  ['ready', transitionSet('running', 'inbox')],
  ['running', transitionSet('review', 'failed', 'canceled', 'needs_input', 'needs_approval')],
  ['needs_input', transitionSet('ready', 'running', 'failed', 'canceled', 'inbox')],
  ['needs_approval', transitionSet('ready', 'running', 'failed', 'canceled', 'inbox')],
  ['review', transitionSet('done', 'needs_fix', 'canceled', 'inbox')],
  ['needs_fix', transitionSet('ready', 'running', 'canceled', 'inbox')],
  ['done', transitionSet('inbox')],
  ['failed', transitionSet('ready', 'inbox')],
  ['canceled', transitionSet('ready', 'inbox')],
]);

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUSES.includes(value as TaskStatus);
}

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return LEGAL_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTaskStatus(from, to)) {
    throw new Error(`Illegal task transition: ${from} -> ${to}`);
  }
}

export function isRunnableTaskStatus(status: TaskStatus): boolean {
  return status === 'ready' || status === 'needs_fix';
}
