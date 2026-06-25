import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';

// Canonical full-shape work order for integration scenarios. Defaults to a
// runnable Claude card; override frontmatter fields per case.
export function makeTask(id: string, overrides: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    frontmatter: {
      type: 'specorator-work-order',
      schema_version: 1,
      id,
      title: id,
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

// One macrotask hop drains the whole pending microtask cascade (run -> settle ->
// tick -> run ...). A few hops give nested holds room to resolve.
export const flush = async (cycles = 8): Promise<void> => {
  for (let i = 0; i < cycles; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
