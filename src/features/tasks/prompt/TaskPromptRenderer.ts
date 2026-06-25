import type { LoopDefinition } from '../loops/loopTypes';
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

/**
 * Renders a "Prior Attempts" section from the run ledger, but only on reruns.
 * A rerun is detected by a prior `[review]` or `[needs_fix]` entry — a first run
 * has only `[running]` lines and should not echo its own live ledger back.
 */
function renderPriorAttempts(ledger: string): string {
  if (!ledger) return '';
  const lines = ledger.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return '';
  const isRerun = lines.some((l) => /\[(review|needs_fix)\]/.test(l));
  if (!isRerun) return '';
  const tail = lines.slice(-20);
  return `\n\n## Prior Attempts\nLedger from previous attempts (most recent at the bottom):\n${tail.join('\n')}`;
}

/**
 * Wrap any `<specorator_*>` substring in backticks so a polluted title or section
 * cannot impersonate a real protocol block. The agent still reads the intent;
 * the stream parser regex (which looks for a literal `<specorator_<kind>>`) does
 * not match a backticked occurrence. Applied to every user-supplied string the
 * renderer interpolates; renderer-emitted blocks below are deliberately
 * literal and unescaped.
 */
function escapeSpecoratorMarkers(value: string): string {
  if (!value) return value;
  return value.replace(/<(\/?)specorator_([A-Za-z_]+)>/g, '`<$1specorator_$2>`');
}

/**
 * Render the attached loop as a `## Loop` block. `useWhen` is selection-only
 * guidance and is deliberately never injected. All values are escaped against
 * protocol-marker injection, identical to the work-order sections.
 */
function renderLoopBlock(loop?: LoopDefinition): string {
  if (!loop) return '';
  const parts: string[] = [
    `\n\n## Loop: ${escapeSpecoratorMarkers(loop.name)}`,
    'You are following a predefined loop. Apply its approach, work the steps, and satisfy its verify condition before handing off.',
  ];
  const sub = (heading: string, value: string): void => {
    const escaped = escapeSpecoratorMarkers(value).trim();
    if (escaped) parts.push(`\n### ${heading}\n${escaped}`);
  };
  sub('Approach', loop.approach);
  sub('Steps', loop.steps);
  sub('Verify', loop.verify);
  sub('Notes', loop.notes);
  return parts.join('\n');
}

export function renderTaskPrompt(
  task: TaskSpec,
  lane?: TaskPromptLaneCriteria,
  loop?: LoopDefinition,
): string {
  const provider = task.frontmatter.provider ?? 'unspecified';
  const model = task.frontmatter.model ?? 'unspecified';
  const title = escapeSpecoratorMarkers(task.frontmatter.title);
  const objective = escapeSpecoratorMarkers(task.sections.objective);
  const acceptanceCriteria = escapeSpecoratorMarkers(task.sections.acceptanceCriteria);
  const context = escapeSpecoratorMarkers(task.sections.context);
  const constraints = escapeSpecoratorMarkers(task.sections.constraints);

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

  const protocol = `

## Protocol
While running, you may emit these inline blocks. Use them whenever the situation calls for them; the harness watches the stream and reacts. Put each field on its own line as \`key: value\` (do not put multiple fields on one line).

Progress — optional milestone updates; emit at natural boundaries, do not flood:
<specorator_progress>
step: short description of what you are doing
done: N/M
note: optional extra detail
</specorator_progress>

Needs input — when you genuinely need information you cannot derive. End your turn after this block; the run pauses and you will be resumed with the user's reply:
<specorator_needs_input>
question: what you need to know
why: optional reason it is ambiguous
default: optional value to assume if the user does not answer
</specorator_needs_input>

Needs approval — before destructive or irreversible operations. End your turn after this block; the run pauses and you will be resumed only if the user approves:
<specorator_needs_approval>
action: what you intend to do
risk: optional description of the risk
reversible: true|false
</specorator_needs_approval>

End the entire run with one <specorator_handoff> block as specified below.`;

  const priorAttempts = renderPriorAttempts(task.sections.ledger);
  const loopBlock = renderLoopBlock(loop);

  return `${title}

You are executing a Specorator work order. Complete only the task described below and respect all constraints.

## Work Order
Work order path: ${task.path}
Title: ${title}
Task ID: ${task.frontmatter.id}
Provider/model: ${provider} / ${model}

## Objective
${objective}

## Acceptance Criteria
${acceptanceCriteria}

## Progress Tracking
As you complete each acceptance criterion above, edit this work order note (${task.path}) and change the matching \`- [ ]\` checkbox to \`- [x]\`. Keep the checklist accurate as you make progress. Do not edit the Run Ledger or Result / Handoff sections — Specorator owns those.

## Docs Sync
While executing, update the related docs referenced from Objective/Context (plan, spec, ADR, issue, PRD) so progress is visible to humans reading those docs — do not let the work order be the only place that reflects current state. Before completing the work order, verify all related docs are updated to reflect the final state and any decisions made during the run.${protocol}

## Context
${context}

## Constraints
${constraints}${dor}${dod}${reworkNotes}${priorAttempts}${loopBlock}

## Required Structured Handoff
At the end of your final response, include exactly one strict handoff block in this format:

<specorator_handoff>
summary: Briefly describe what changed.
verification: List the checks you ran and their results.
risks: List remaining risks or write "None".
next_action: State the next concrete action for the human or follow-up agent.
</specorator_handoff>

The handoff fields are required. Do not omit summary, verification, risks, or next_action.`;
}
