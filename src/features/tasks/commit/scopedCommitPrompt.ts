import { GIT_COMMIT_PROMPT } from '../../../core/prompt/gitCommit';
import type { TaskSpec } from '../model/taskTypes';

const CHECKBOX_DONE = /^\s*[-*]\s+\[(x|X)\]\s+(.*)$/;

function extractCheckedAcceptanceItems(acceptanceCriteria: string): string[] {
  const items: string[] = [];
  for (const line of acceptanceCriteria.split(/\r?\n/)) {
    const match = line.match(CHECKBOX_DONE);
    if (match) items.push(match[2].trim());
  }
  return items;
}

/**
 * Composes the scoped commit prompt sent to the work-order's chat conversation.
 * Pure: deterministic for the same TaskSpec + dirtyCount input.
 */
export function buildScopedCommitPrompt(task: TaskSpec, _dirtyCount: number): string {
  const lines: string[] = [GIT_COMMIT_PROMPT, '', 'Scope this commit to the following accepted Work-Order:', ''];

  lines.push(`Work-Order: ${task.frontmatter.id} — ${task.frontmatter.title}`);

  const objective = task.sections.objective.trim();
  if (objective.length > 0) {
    lines.push('', 'Objective:', objective);
  }

  const checkedItems = extractCheckedAcceptanceItems(task.sections.acceptanceCriteria);
  if (checkedItems.length > 0) {
    lines.push('', 'Acceptance criteria completed:');
    for (const item of checkedItems) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}
