import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import { flush, makeTask } from './queueRunnerKit';

describe('QueueRunner integration — halt after failures', () => {
  it('halts after 3 consecutive failures, resumes on clearHalt', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    let nextOk = false;
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')];
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: {
        isProviderEnabled: () => true,
        ownsModel: () => true,
        isActive: (id) => slot.isHeld(id),
      },
      coordinator: {
        run: async (task) => {
          runs.push(task.frontmatter.id);
          if (nextOk) {
            task.frontmatter.status = 'review';
            return { ok: true, status: 'review' };
          }
          task.frontmatter.status = 'failed';
          return { ok: false, error: 'boom' };
        },
        isActive: (id) => slot.isHeld(id),
      },
      appendLedger: async () => {},
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    await flush();
    expect(runs).toEqual(['a', 'b', 'c']);
    expect(runner.isHalted()).toBe(true);

    nextOk = true;
    runner.clearHalt();
    runner.tick();
    await flush();
    expect(runs).toEqual(['a', 'b', 'c', 'd']);
    expect(runner.isHalted()).toBe(false);
  });
});
