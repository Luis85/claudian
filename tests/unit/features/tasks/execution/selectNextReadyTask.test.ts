import { selectNextReadyTask } from '@/features/tasks/execution/selectNextReadyTask';
import type { TaskPriority, TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';

const task = (id: string, status: TaskStatus, priority: TaskPriority, created: string): TaskSpec =>
  ({
    path: `${id}.md`,
    frontmatter: { type: 'claudian-work-order', schema_version: 1, id, title: id, status, priority, created, updated: created, attempts: 0 },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  } as TaskSpec);

const isReady = (s: TaskStatus) => s === 'ready';

describe('selectNextReadyTask', () => {
  it('returns null when nothing is ready', () => {
    expect(selectNextReadyTask([task('a', 'running', '1 - high', '1')], isReady)).toBeNull();
  });

  it('prefers higher priority, then older created', () => {
    const tasks = [
      task('low-old', 'ready', '3 - low', '2026-01-01'),
      task('high-new', 'ready', '1 - high', '2026-03-01'),
      task('high-old', 'ready', '1 - high', '2026-02-01'),
    ];
    expect(selectNextReadyTask(tasks, isReady)?.frontmatter.id).toBe('high-old');
  });

  it('returns the first task when priority and created tie', () => {
    const tasks = [
      task('first', 'ready', '2 - normal', '2026-01-01'),
      task('second', 'ready', '2 - normal', '2026-01-01'),
    ];
    expect(selectNextReadyTask(tasks, isReady)?.frontmatter.id).toBe('first');
  });

  it('skips non-ready statuses', () => {
    const tasks = [task('r', 'review', '0 - urgent', '1'), task('ready', 'ready', '2 - normal', '2')];
    expect(selectNextReadyTask(tasks, isReady)?.frontmatter.id).toBe('ready');
  });
});
