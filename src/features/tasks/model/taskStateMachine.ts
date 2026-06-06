import type { TaskStatus } from './taskTypes';

export const TASK_STATUSES = Object.freeze([
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
] as const satisfies readonly TaskStatus[]);

const LEGAL_TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map([
  ['inbox', new Set(['ready'])],
  ['ready', new Set(['running'])],
  ['running', new Set(['review', 'failed', 'canceled', 'needs_input', 'needs_approval', 'needs_handoff'])],
  ['needs_input', new Set(['running', 'failed', 'canceled'])],
  ['needs_approval', new Set(['running', 'failed', 'canceled'])],
  ['review', new Set(['done', 'needs_fix', 'canceled'])],
  ['needs_fix', new Set(['ready', 'running', 'canceled'])],
  ['needs_handoff', new Set(['review', 'failed'])],
  ['done', new Set(['inbox'])],
  ['failed', new Set(['ready'])],
  ['canceled', new Set()],
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
