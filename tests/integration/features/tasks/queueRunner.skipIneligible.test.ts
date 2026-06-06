import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import { flush, makeTask } from './queueRunnerKit';

describe('QueueRunner integration — skip ineligible', () => {
  it('skips disabled-provider cards and runs the next eligible', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    const ledger: string[] = [];
    const skipped: string[] = [];
    const tasks = [makeTask('a', { provider: 'codex' }), makeTask('b')];
    const runner = new QueueRunner({
      slot,
      getTasks: () => tasks,
      eligibility: {
        isProviderEnabled: (id) => id !== 'codex',
        ownsModel: () => true,
        isActive: (id) => slot.isHeld(id),
      },
      coordinator: {
        run: async (task) => {
          runs.push(task.frontmatter.id);
          task.frontmatter.status = 'review';
          return { ok: true, status: 'review' };
        },
        isActive: (id) => slot.isHeld(id),
      },
      appendLedger: async (task, entry) => {
        ledger.push(`${task.frontmatter.id}:${entry.message}`);
      },
      events: {
        emit: (name, ...args) => {
          if (name === 'task:queue-skipped') skipped.push((args[0] as { taskId: string }).taskId);
        },
        on: () => () => {},
      },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => Date.now(),
    });
    runner.tick();
    await flush();
    expect(runs).toEqual(['b']);
    expect(skipped).toEqual(['a']);
    expect(ledger).toEqual(["a:queue: skipped (provider 'codex' is disabled)"]);
  });
});
