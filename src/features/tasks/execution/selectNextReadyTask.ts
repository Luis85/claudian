import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';

function getPriorityRank(priority: TaskPriority): number {
  const rank = parseInt(priority, 10);
  return Number.isNaN(rank) ? Number.POSITIVE_INFINITY : rank;
}

export function selectNextReadyTask(
  tasks: TaskSpec[],
  isReady: (status: TaskStatus) => boolean,
): TaskSpec | null {
  const eligible = tasks.filter(
    (task) => isReady(task.frontmatter.status) && task.frontmatter.status !== 'running',
  );
  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    const byPriority = getPriorityRank(a.frontmatter.priority) - getPriorityRank(b.frontmatter.priority);
    if (byPriority !== 0) return byPriority;
    return a.frontmatter.created.localeCompare(b.frontmatter.created);
  })[0];
}
