import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function selectNextReadyTask(
  tasks: TaskSpec[],
  isReady: (status: TaskStatus) => boolean,
): TaskSpec | null {
  const eligible = tasks.filter(
    (task) => isReady(task.frontmatter.status) && task.frontmatter.status !== 'running',
  );
  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.frontmatter.priority] - PRIORITY_RANK[b.frontmatter.priority];
    if (byPriority !== 0) return byPriority;
    return a.frontmatter.created.localeCompare(b.frontmatter.created);
  })[0];
}
