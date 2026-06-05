import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import { flush, makeTask } from './queueRunnerKit';

describe('QueueRunner integration — cap change live', () => {
  it('opens slots when cap is raised mid-run', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    let release!: () => void;
    const block = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
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
          if (task.frontmatter.id === 'a') await block;
          task.frontmatter.status = 'review';
          return { ok: true, status: 'review' };
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
    await flush(5);
    expect(runs).toEqual(['a']);

    slot.setCap(3);
    runner.tick();
    await flush(5);
    expect(runs.slice().sort()).toEqual(['a', 'b', 'c']);

    release();
    await flush();
  });
});
