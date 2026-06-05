import { isRunnableTaskStatus } from '../model/taskStateMachine';
import type { TaskPriority, TaskSpec } from '../model/taskTypes';

export interface EligibilityPredicates {
  isProviderEnabled: (providerId: string) => boolean;
  ownsModel: (providerId: string, model: string) => boolean;
  isActive: (taskId: string) => boolean;
}

export type EligibilityResult =
  | { kind: 'ok'; task: TaskSpec }
  | { kind: 'skipped'; task: TaskSpec; reason: string };

function priorityRank(priority: TaskPriority): number {
  const rank = parseInt(priority, 10);
  return Number.isNaN(rank) ? Number.POSITIVE_INFINITY : rank;
}

// Picks the single highest-priority runnable card (priority, then created-asc)
// that is not excluded and not already in flight, then reports whether it is
// eligible to launch or must be skipped with a stable, human-readable reason.
// Returning the skip (rather than silently filtering) lets the runner surface a
// chip + ledger entry and advance past it via the `excluded` set.
export function selectNextEligibleTask(
  tasks: TaskSpec[],
  predicates: EligibilityPredicates,
  excluded: ReadonlySet<string>,
): EligibilityResult | null {
  const candidates = tasks.filter(
    (t) =>
      isRunnableTaskStatus(t.frontmatter.status) &&
      t.frontmatter.status !== 'running' &&
      !excluded.has(t.frontmatter.id) &&
      !predicates.isActive(t.frontmatter.id),
  );
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const byPriority = priorityRank(a.frontmatter.priority) - priorityRank(b.frontmatter.priority);
    if (byPriority !== 0) return byPriority;
    return a.frontmatter.created.localeCompare(b.frontmatter.created);
  });

  const task = sorted[0];
  const { provider, model } = task.frontmatter;
  if (!provider) return { kind: 'skipped', task, reason: 'work order is missing provider' };
  if (!model) return { kind: 'skipped', task, reason: 'work order is missing model' };
  if (!predicates.isProviderEnabled(provider)) {
    return { kind: 'skipped', task, reason: `provider '${provider}' is disabled` };
  }
  if (!predicates.ownsModel(provider, model)) {
    return {
      kind: 'skipped',
      task,
      reason: `model '${model}' is not available for provider '${provider}'`,
    };
  }
  return { kind: 'ok', task };
}
