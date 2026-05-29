import type { TaskSpec } from '../model/taskTypes';

export interface TaskPromptLaneCriteria {
  definitionOfReady: string[];
  definitionOfDone: string[];
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

  return `You are executing a Claudian work order. Complete only the task described below and respect all constraints.

## Work Order
Work order path: ${task.path}
Title: ${task.frontmatter.title}
Task ID: ${task.frontmatter.id}
Provider/model: ${provider} / ${model}

## Objective
${task.sections.objective}

## Acceptance Criteria
${task.sections.acceptanceCriteria}

## Context
${task.sections.context}

## Constraints
${task.sections.constraints}${dor}${dod}

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
