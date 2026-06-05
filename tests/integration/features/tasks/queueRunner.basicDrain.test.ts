import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import { flush, makeTask } from './queueRunnerKit';

describe('QueueRunner integration — basic drain (cap=1)', () => {
  it('drains three ready cards in priority then created order', async () => {
    const slot = new QueueSlotTracker(1);
    const runOrder: string[] = [];
    const tasks = [
      makeTask('a', { priority: '2 - normal', created: '2026-06-01T01:00:00Z' }),
      makeTask('b', { priority: '1 - high', created: '2026-06-01T02:00:00Z' }),
      makeTask('c', { priority: '2 - normal', created: '2026-06-01T00:30:00Z' }),
    ];
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
          runOrder.push(task.frontmatter.id);
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
    await flush();
    expect(runOrder).toEqual(['b', 'c', 'a']);
  });
});
