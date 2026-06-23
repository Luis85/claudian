import { QueueRunner } from '../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskRunResult } from '../../src/features/tasks/execution/TaskRunCoordinator';
import type { TaskSpec } from '../../src/features/tasks/model/taskTypes';

function makeTask(id: string, status: 'ready' | 'done'): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    frontmatter: {
      type: 'specorator-work-order',
      schema_version: 1,
      id,
      title: id,
      status,
      priority: '2 - normal',
      created: '2026-06-01T00:00:00Z',
      updated: '2026-06-01T00:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      attempts: 0,
    },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  };
}

// Counts how many times the eligibility predicate is consulted for one drain
// pass. The first launched card holds the (never-released) slot, so the pass
// stops after one selection — the probe count reflects only runnable cards
// scanned, never the full board.
function eligibilityProbes(totalTasks: number, runnableCount: number): number {
  const tasks: TaskSpec[] = [];
  for (let i = 0; i < totalTasks; i++) {
    tasks.push(makeTask(`t${i}`, i < runnableCount ? 'ready' : 'done'));
  }
  let probes = 0;
  const runner = new QueueRunner({
    slot: new QueueSlotTracker(1),
    getTasks: () => tasks,
    eligibility: {
      isProviderEnabled: () => true,
      ownsModel: () => true,
      isActive: () => {
        probes += 1;
        return false;
      },
    },
    coordinator: {
      run: () => new Promise<TaskRunResult>(() => {}),
      isActive: () => false,
    },
    appendLedger: async () => {},
    events: { emit: () => {}, on: () => () => {} },
    haltAfterFailures: 3,
    initialPaused: false,
    now: () => Date.now(),
  });
  runner.tick();
  return probes;
}

describe('QueueRunner perf', () => {
  it('tick predicate cost scales with runnable cards, not total board size', () => {
    const few = eligibilityProbes(1000, 1);
    const more = eligibilityProbes(1000, 10);
    // Linear in runnable count, not the 1000-card total.
    expect(more).toBeLessThanOrEqual(few * 12 + 2);
    expect(few).toBeLessThan(50);
  });
});
