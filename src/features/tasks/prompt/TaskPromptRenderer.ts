import type { TaskSpec } from '../model/taskTypes';

export interface TaskPromptLaneCriteria {
  definitionOfReady: string[];
  definitionOfDone: string[];
}

const DEFAULT_REWORK_MESSAGE = 'Sent back for rework.';

/**
 * Scans the run ledger (newest-first) for the last `[needs_fix]` entry and
 * returns its message when it differs from the default canned string.
 * Returns `null` when no custom reason was recorded.
 */
function extractReworkReason(ledger: string): string | null {
  if (!ledger) return null;
  const lines = ledger.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^-\s+\S+\s+\[needs_fix\]\s+(.+)$/);
    if (match) {
      const msg = match[1].trim();
      return msg && msg !== DEFAULT_REWORK_MESSAGE ? msg : null;
    }
  }
  return null;
}

export function renderTaskPrompt(task: TaskSpec, lane?: TaskPromptLaneCriteria): string {
  const provider = task.frontmatter.provider ?? 'unspecified';
  const model = task.frontmatter.model ?? 'unspecified';

  const dor =
    lane && lane.definitionOfReady.length > 0
      ? `\n\n## Definition of Ready\n${lane.definitionOfReady.map((item) => `- ${item}`).join('\n')}`
      : '';
  const dod =
    lane && lane.definitionOfDone.length > 0
      ? `\n\n## Definition of Done\n${lane.definitionOfDone.map((item) => `- ${item}`).join('\n')}`
      : '';

  const reworkReason = extractReworkReason(task.sections.ledger);
  const reworkNotes = reworkReason ? `\n\n## Rework Notes\n${reworkReason}` : '';

  return `${task.frontmatter.title}

You are executing a Claudian work order. Complete only the task described below and respect all constraints.

## Work Order
Work order path: ${task.path}
Title: ${task.frontmatter.title}
Task ID: ${task.frontmatter.id}
Provider/model: ${provider} / ${model}

## Objective
${task.sections.objective}

## Acceptance Criteria
${task.sections.acceptanceCriteria}

## Progress Tracking
As you complete each acceptance criterion above, edit this work order note (${task.path}) and change the matching \`- [ ]\` checkbox to \`- [x]\`. Keep the checklist accurate as you make progress. Do not edit the Run Ledger or Result / Handoff sections — Claudian owns those.

## Docs Sync
While executing, update the related docs referenced from Objective/Context (plan, spec, ADR, issue, PRD) so progress is visible to humans reading those docs — do not let the work order be the only place that reflects current state. Before completing the work order, verify all related docs are updated to reflect the final state and any decisions made during the run.

## Context
${task.sections.context}

## Constraints
${task.sections.constraints}${dor}${dod}${reworkNotes}

## Required Structured Handoff
At the end of your final response, include exactly one strict handoff block in this format:

<claudian_handoff>
summary: Briefly describe what changed.
verification: List the checks you ran and their results.
risks: List remaining risks or write "None".
next_action: State the next concrete action for the human or follow-up agent.
</claudian_handoff>

The handoff fields are required. Do not omit summary, verification, risks, or next_action.`;
}
