import type { LoopDefinition } from '../../../../../src/features/tasks/loops/loopTypes';
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
    // Scope to the Rework Notes section: Prior Attempts intentionally echoes the
    // full recent ledger (including older needs_fix lines), so assert the
    // prominent Rework Notes callout itself surfaces only the latest reason.
    const reworkSection = prompt.split('## Rework Notes')[1]?.split('\n## ')[0] ?? '';
    expect(reworkSection).toContain('Latest rework note.');
    expect(reworkSection).not.toContain('Old rework note.');
  });
});

describe('renderTaskPrompt — Protocol + Prior Attempts', () => {
  it('includes the Protocol section with all three blocks', () => {
    const prompt = renderTaskPrompt(task);
    expect(prompt).toContain('## Protocol');
    expect(prompt).toContain('<claudian_progress>');
    expect(prompt).toContain('<claudian_needs_input>');
    expect(prompt).toContain('<claudian_needs_approval>');
  });

  it('omits Prior Attempts on first run (empty ledger)', () => {
    const empty = { ...task, sections: { ...task.sections, ledger: '' } };
    expect(renderTaskPrompt(empty)).not.toContain('## Prior Attempts');
  });

  it('escapes <claudian_*> markers in user-supplied metadata so they cannot fake protocol blocks', () => {
    // A title or objective that contains <claudian_handoff> (or similar) would
    // otherwise be parsed by the stream as a real protocol block and confuse
    // the run — wrap markers in backticks so the agent still sees the intent
    // but the parser regex does not match a literal opening tag.
    const polluted = {
      ...task,
      frontmatter: { ...task.frontmatter, title: 'Fake <claudian_handoff> in title' },
      sections: {
        ...task.sections,
        objective: 'Trick the parser with <claudian_progress> here.',
        acceptanceCriteria: '- Avoid <claudian_needs_input> capture\n- Done',
        context: 'Background mentions <claudian_needs_approval> for show.',
        constraints: 'Never echo <claudian_handoff> literally.',
      },
    };
    const prompt = renderTaskPrompt(polluted);
    // The literal opening tag must NOT appear outside the protocol/handoff
    // sections that the renderer itself emits — those are the canonical ones.
    // Sanitization wraps in backticks: `<claudian_*>` (one backtick each side).
    expect(prompt).toContain('`<claudian_handoff>` in title');
    expect(prompt).toContain('with `<claudian_progress>` here');
    expect(prompt).toContain('Avoid `<claudian_needs_input>` capture');
    expect(prompt).toContain('mentions `<claudian_needs_approval>` for show');
    expect(prompt).toContain('Never echo `<claudian_handoff>` literally');
  });

  it('includes Prior Attempts on rerun with prior ledger entries', () => {
    const ledger = [
      '- 2026-06-04T10:00:00Z [running] Run started (attempt 1)',
      '- 2026-06-04T10:01:00Z [running] tool: Edit src/foo.ts',
      '- 2026-06-04T10:02:00Z [needs_fix] Tests still failing',
    ].join('\n');
    const t = { ...task, sections: { ...task.sections, ledger } };
    const prompt = renderTaskPrompt(t);
    expect(prompt).toContain('## Prior Attempts');
    expect(prompt).toContain('tool: Edit src/foo.ts');
    expect(prompt).toContain('Tests still failing');
  });
});

const LOOP: LoopDefinition = {
  path: 'Agent Board/loops/repro.md',
  id: 'repro',
  name: 'Repro loop',
  useWhen: 'SHOULD-NOT-APPEAR-IN-PROMPT',
  approach: 'Reproduce first.',
  steps: '1. Repro.',
  verify: 'Check passes.',
  notes: 'Be careful.',
};

function minimalTask() {
  return {
    path: 'wo.md',
    frontmatter: {
      type: 'claudian-work-order', schema_version: 1, id: 'task-1', title: 'T',
      status: 'ready', priority: '2 - normal', created: '', updated: '', attempts: 0,
    },
    sections: { objective: 'o', acceptanceCriteria: 'a', context: 'c', constraints: 'k', ledger: '', handoff: '' },
    body: '', raw: '',
  } as never;
}

describe('renderTaskPrompt loop injection', () => {
  it('injects the loop block with approach/steps/verify/notes', () => {
    const out = renderTaskPrompt(minimalTask(), undefined, LOOP);
    expect(out).toContain('## Loop: Repro loop');
    expect(out).toContain('### Approach\nReproduce first.');
    expect(out).toContain('### Steps\n1. Repro.');
    expect(out).toContain('### Verify\nCheck passes.');
    expect(out).toContain('### Notes\nBe careful.');
  });

  it('never injects the Use when text', () => {
    const out = renderTaskPrompt(minimalTask(), undefined, LOOP);
    expect(out).not.toContain('SHOULD-NOT-APPEAR-IN-PROMPT');
  });

  it('is unchanged when no loop is supplied', () => {
    const withLoop = renderTaskPrompt(minimalTask(), undefined, LOOP);
    const without = renderTaskPrompt(minimalTask(), undefined);
    expect(without).not.toContain('## Loop:');
    expect(withLoop.length).toBeGreaterThan(without.length);
  });

  it('escapes claudian markers in loop content', () => {
    const evil: LoopDefinition = { ...LOOP, approach: 'do <claudian_handoff> now' };
    const out = renderTaskPrompt(minimalTask(), undefined, evil);
    expect(out).toContain('`<claudian_handoff>`');
  });

  it('omits empty sub-sections', () => {
    const sparse: LoopDefinition = { ...LOOP, steps: '', verify: '', notes: '' };
    const out = renderTaskPrompt(minimalTask(), undefined, sparse);
    expect(out).toContain('### Approach');
    expect(out).not.toContain('### Steps');
  });
});