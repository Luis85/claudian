import { GIT_COMMIT_PROMPT } from '@/core/prompt/gitCommit';
import { buildScopedCommitPrompt } from '@/features/tasks/commit/scopedCommitPrompt';
import type { TaskSpec } from '@/features/tasks/model/taskTypes';

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    path: 'Agent Board/tasks/wo-1.md',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 'wo-1',
      title: 'Add commit-on-accept modal',
      status: 'done',
      priority: '2 - normal',
      created: '2026-06-04T10:00:00Z',
      updated: '2026-06-04T11:00:00Z',
      attempts: 1,
    },
    sections: {
      objective: 'Prompt user to commit after Accept.',
      acceptanceCriteria: '- [x] Modal opens on Accept\n- [x] Skip writes setting\n- [ ] Open question',
      context: '',
      constraints: '',
      ledger: '',
      handoff: '',
    },
    body: '',
    raw: '',
    ...overrides,
  };
}

describe('buildScopedCommitPrompt', () => {
  it('embeds work-order id and title', () => {
    const out = buildScopedCommitPrompt(makeTask(), 3);
    expect(out).toContain('Work-Order: wo-1 — Add commit-on-accept modal');
  });

  it('includes Objective verbatim', () => {
    const out = buildScopedCommitPrompt(makeTask(), 3);
    expect(out).toContain('Objective:');
    expect(out).toContain('Prompt user to commit after Accept.');
  });

  it('includes only checked acceptance criteria items', () => {
    const out = buildScopedCommitPrompt(makeTask(), 3);
    expect(out).toContain('- Modal opens on Accept');
    expect(out).toContain('- Skip writes setting');
    expect(out).not.toContain('- Open question');
  });

  it('omits Objective block when empty', () => {
    const task = makeTask({ sections: { ...makeTask().sections, objective: '' } });
    const out = buildScopedCommitPrompt(task, 3);
    expect(out).not.toContain('Objective:');
  });

  it('omits Acceptance criteria block when no items are checked', () => {
    const task = makeTask({ sections: { ...makeTask().sections, acceptanceCriteria: '- [ ] Not done' } });
    const out = buildScopedCommitPrompt(task, 3);
    expect(out).not.toContain('Acceptance criteria completed:');
  });

  it('preserves GIT_COMMIT_PROMPT body verbatim', () => {
    const out = buildScopedCommitPrompt(makeTask(), 3);
    expect(out).toContain(GIT_COMMIT_PROMPT);
  });

  it('is deterministic for the same input', () => {
    const a = buildScopedCommitPrompt(makeTask(), 3);
    const b = buildScopedCommitPrompt(makeTask(), 3);
    expect(a).toBe(b);
  });
});
