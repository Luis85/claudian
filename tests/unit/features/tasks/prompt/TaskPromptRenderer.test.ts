import type { TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';
import { renderTaskPrompt } from '../../../../../src/features/tasks/prompt/TaskPromptRenderer';

const task: TaskSpec = {
  path: 'tasks/task-123.md',
  frontmatter: {
    type: 'claudian-work-order',
    schema_version: 1,
    id: 'task-123',
    title: 'Build agent board prompt flow',
    status: 'ready',
    priority: '2 - normal',
    created: '2026-05-28T08:00:00.000Z',
    updated: '2026-05-28T08:00:00.000Z',
    provider: 'codex',
    model: 'gpt-5-codex',
    attempts: 0,
  },
  sections: {
    objective: 'Render a task prompt for an agent run.',
    acceptanceCriteria: '- Includes all task metadata.\n- Requires structured handoff.',
    context: 'This runs from the Agent Board thin slice.',
    constraints: 'Do not touch unrelated files.',
    ledger: '- Existing run entry.',
    handoff: 'Previous handoff.',
  },
  body: '# Build agent board prompt flow',
  raw: 'raw note content',
};

describe('renderTaskPrompt', () => {
  it('includes task context and strict handoff instructions', () => {
    const prompt = renderTaskPrompt(task);

    expect(prompt).toContain('Work order path: tasks/task-123.md');
    expect(prompt).toContain('Title: Build agent board prompt flow');
    expect(prompt).toContain('Task ID: task-123');
    expect(prompt).toContain('Provider/model: codex / gpt-5-codex');
    expect(prompt).toContain('Render a task prompt for an agent run.');
    expect(prompt).toContain('- Includes all task metadata.\n- Requires structured handoff.');
    expect(prompt).toContain('This runs from the Agent Board thin slice.');
    expect(prompt).toContain('Do not touch unrelated files.');
    expect(prompt).toContain('<claudian_handoff>');
    expect(prompt).toContain('summary:');
    expect(prompt).toContain('verification:');
    expect(prompt).toContain('risks:');
    expect(prompt).toContain('next_action:');
    expect(prompt).toContain('</claudian_handoff>');
  });

  it('includes definition of ready and done when lane criteria are provided', () => {
    const prompt = renderTaskPrompt(task, { definitionOfReady: ['Objective is clear'], definitionOfDone: ['Tests pass'] });
    expect(prompt).toContain('## Definition of Ready');
    expect(prompt).toContain('- Objective is clear');
    expect(prompt).toContain('## Definition of Done');
    expect(prompt).toContain('- Tests pass');
  });

  it('instructs the agent to tick acceptance-criteria checkboxes in the note during the run', () => {
    const prompt = renderTaskPrompt(task);
    expect(prompt).toContain('## Progress Tracking');
    expect(prompt).toContain('- [x]');
    expect(prompt).toContain(task.path);
  });

  it('instructs the agent to keep related docs in sync during and before completion', () => {
    const prompt = renderTaskPrompt(task);
    expect(prompt).toContain('## Docs Sync');
    expect(prompt).toMatch(/update.*related docs/i);
    expect(prompt).toMatch(/before.*complet/i);
  });

  it('omits criteria sections when the lane is absent or empty', () => {
    expect(renderTaskPrompt(task)).not.toContain('## Definition of Ready');
    expect(renderTaskPrompt(task, { definitionOfReady: [], definitionOfDone: [] })).not.toContain('## Definition of Done');
  });
});

describe('renderTaskPrompt — Rework Notes', () => {
  function makeTaskWithLedger(ledger: string): TaskSpec {
    return { ...task, sections: { ...task.sections, ledger } };
  }

  it('includes ## Rework Notes when last needs_fix ledger entry has a custom reason', () => {
    const t = makeTaskWithLedger(
      '- 2026-06-04T10:00:00Z [running] Started run.\n' +
      '- 2026-06-04T11:00:00Z [needs_fix] Fix the broken import in module X.',
    );
    const prompt = renderTaskPrompt(t);
    expect(prompt).toContain('## Rework Notes');
    expect(prompt).toContain('Fix the broken import in module X.');
  });

  it('omits ## Rework Notes when last needs_fix entry is the default canned message', () => {
    const t = makeTaskWithLedger(
      '- 2026-06-04T10:00:00Z [needs_fix] Sent back for rework.',
    );
    const prompt = renderTaskPrompt(t);
    expect(prompt).not.toContain('## Rework Notes');
  });

  it('omits ## Rework Notes when no needs_fix entry exists in ledger', () => {
    const t = makeTaskWithLedger(
      '- 2026-06-04T10:00:00Z [running] Started run.\n' +
      '- 2026-06-04T11:00:00Z [review] Handoff written.',
    );
    const prompt = renderTaskPrompt(t);
    expect(prompt).not.toContain('## Rework Notes');
  });

  it('uses the LAST needs_fix entry when multiple exist', () => {
    const t = makeTaskWithLedger(
      '- 2026-06-01T00:00:00Z [needs_fix] Old rework note.\n' +
      '- 2026-06-02T00:00:00Z [running] Started run.\n' +
      '- 2026-06-03T00:00:00Z [needs_fix] Latest rework note.',
    );
    const prompt = renderTaskPrompt(t);
    expect(prompt).toContain('Latest rework note.');
    expect(prompt).not.toContain('Old rework note.');
  });
});