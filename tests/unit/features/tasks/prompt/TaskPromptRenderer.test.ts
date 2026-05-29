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
    priority: 'normal',
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

  it('omits criteria sections when the lane is absent or empty', () => {
    expect(renderTaskPrompt(task)).not.toContain('## Definition of Ready');
    expect(renderTaskPrompt(task, { definitionOfReady: [], definitionOfDone: [] })).not.toContain('## Definition of Done');
  });
});