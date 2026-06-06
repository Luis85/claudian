import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import { flush, makeTask } from './queueRunnerKit';

describe('QueueRunner integration — hold slot on pause', () => {
  it('does not launch a second card while the first holds the slot', async () => {
    const slot = new QueueSlotTracker(1);
    const runCalls: string[] = [];
    let releaseA!: () => void;
    const aRun = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const tasks = [makeTask('a'), makeTask('b')];
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
          runCalls.push(task.frontmatter.id);
          if (task.frontmatter.id === 'a') await aRun;
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
    expect(runCalls).toEqual(['a']);
    expect(slot.occupied()).toBe(1);

    // A second nudge while the slot is held must not start the next card.
    runner.tick();
    await flush(5);
    expect(runCalls).toEqual(['a']);

    releaseA();
    await flush();
    expect(runCalls).toEqual(['a', 'b']);
  });
});
