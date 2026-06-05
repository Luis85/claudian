import {
  type EligibilityPredicates,
  selectNextEligibleTask,
} from '../../../../../src/features/tasks/execution/selectNextEligibleTask';
import type { TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';

function makeTask(overrides: Partial<TaskSpec['frontmatter']> & { id: string }): TaskSpec {
  return {
    path: `tasks/${overrides.id}.md`,
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      title: overrides.id,
      status: 'ready',
      priority: '2 - normal',
      created: '2026-06-01T00:00:00Z',
      updated: '2026-06-01T00:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      attempts: 0,
      ...overrides,
    },
    sections: {
      objective: '',
      acceptanceCriteria: '',
      context: '',
      constraints: '',
      ledger: '',
      handoff: '',
    },
    body: '',
    raw: '',
  };
}

const allHealthy: EligibilityPredicates = {
  isProviderEnabled: () => true,
  ownsModel: () => true,
  isActive: () => false,
};

describe('selectNextEligibleTask', () => {
  it('returns null when no candidates exist', () => {
    expect(selectNextEligibleTask([], allHealthy, new Set())).toBeNull();
  });

  it('returns ok for the highest-priority ready candidate', () => {
    const tasks = [
      makeTask({ id: 'a', priority: '2 - normal' }),
      makeTask({ id: 'b', priority: '1 - high' }),
    ];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick?.kind).toBe('ok');
    expect(pick?.task.frontmatter.id).toBe('b');
  });

  it('honors created timestamp as tiebreaker', () => {
    const tasks = [
      makeTask({ id: 'a', created: '2026-06-02T00:00:00Z' }),
      makeTask({ id: 'b', created: '2026-06-01T00:00:00Z' }),
    ];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick?.task.frontmatter.id).toBe('b');
  });

  it('excludes ids in the excluded set', () => {
    const tasks = [
      makeTask({ id: 'a', priority: '1 - high' }),
      makeTask({ id: 'b', priority: '2 - normal' }),
    ];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set(['a']));
    expect(pick?.task.frontmatter.id).toBe('b');
  });

  it('excludes tasks already active in the coordinator', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    const pick = selectNextEligibleTask(
      tasks,
      { ...allHealthy, isActive: (id) => id === 'a' },
      new Set(),
    );
    expect(pick?.task.frontmatter.id).toBe('b');
  });

  it('returns skipped for disabled provider with stable reason', () => {
    const tasks = [makeTask({ id: 'a', provider: 'codex' })];
    const pick = selectNextEligibleTask(
      tasks,
      { ...allHealthy, isProviderEnabled: (id) => id !== 'codex' },
      new Set(),
    );
    expect(pick).toEqual({
      kind: 'skipped',
      task: tasks[0],
      reason: "provider 'codex' is disabled",
    });
  });

  it('returns skipped for unowned model', () => {
    const tasks = [makeTask({ id: 'a', model: 'gpt-7' })];
    const pick = selectNextEligibleTask(
      tasks,
      { ...allHealthy, ownsModel: (_p, m) => m !== 'gpt-7' },
      new Set(),
    );
    expect(pick).toEqual({
      kind: 'skipped',
      task: tasks[0],
      reason: "model 'gpt-7' is not available for provider 'claude'",
    });
  });

  it('returns skipped for missing provider', () => {
    const tasks = [makeTask({ id: 'a', provider: '' as never })];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick).toEqual({
      kind: 'skipped',
      task: tasks[0],
      reason: 'work order is missing provider',
    });
  });

  it('returns skipped for missing model', () => {
    const tasks = [makeTask({ id: 'a', model: '' as never })];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick).toEqual({
      kind: 'skipped',
      task: tasks[0],
      reason: 'work order is missing model',
    });
  });

  it('includes needs_fix as eligible status', () => {
    const tasks = [makeTask({ id: 'a', status: 'needs_fix' })];
    const pick = selectNextEligibleTask(tasks, allHealthy, new Set());
    expect(pick?.kind).toBe('ok');
  });

  it('ignores inbox and running statuses', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'inbox' }),
      makeTask({ id: 'b', status: 'running' }),
    ];
    expect(selectNextEligibleTask(tasks, allHealthy, new Set())).toBeNull();
  });
});
