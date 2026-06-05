import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import { flush, makeTask } from './queueRunnerKit';

describe('QueueRunner integration — manual run does not count against cap', () => {
  it('skips a manually-running card and does not increment the halt counter', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    let manualActive = true; // 'a' is running manually outside the queue
    const tasks = [makeTask('a'), makeTask('b')];
    const active = (id: string): boolean => (id === 'a' && manualActive) || slot.isHeld(id);
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: {
        isProviderEnabled: () => true,
        ownsModel: () => true,
        isActive: active,
      },
      coordinator: {
        run: async (task) => {
          runs.push(task.frontmatter.id);
          task.frontmatter.status = 'review';
          return { ok: true, status: 'review' };
        },
        isActive: active,
      },
      appendLedger: async () => {},
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    await flush();
    // The runner picks b, never the manually-active a.
    expect(runs).toEqual(['b']);

    manualActive = false;
    runner.tick();
    await flush();
    // No failures were counted against the manual run.
    expect(runner.isHalted()).toBe(false);
  });
});
