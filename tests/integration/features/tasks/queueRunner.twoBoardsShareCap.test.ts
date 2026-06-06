import {
  QueueRunner,
  type QueueRunnerCoordinator,
} from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';
import { flush, makeTask } from './queueRunnerKit';

describe('QueueRunner integration — two boards share cap', () => {
  it('cap=1 across two boards lets only one run start; the freed slot serves the other', async () => {
    const slot = new QueueSlotTracker(1);
    const runs: string[] = [];
    let release!: () => void;
    const block = new Promise<void>((resolve) => {
      release = resolve;
    });
    const boardA = [makeTask('a')];
    const boardB = [makeTask('b')];
    const coordinator: QueueRunnerCoordinator = {
      run: async (task) => {
        runs.push(task.frontmatter.id);
        await block;
        task.frontmatter.status = 'review';
        return { ok: true, status: 'review' };
      },
      isActive: (id) => slot.isHeld(id),
    };
    const mkRunner = (getTasks: () => TaskSpec[]) =>
      new QueueRunner({
        slot,
        getTasks,
        eligibility: {
          isProviderEnabled: () => true,
          ownsModel: () => true,
          isActive: (id) => slot.isHeld(id),
        },
        coordinator,
        appendLedger: async () => {},
        events: { emit: () => {}, on: () => () => {} },
        haltAfterFailures: 3,
        initialPaused: false,
        now: () => Date.now(),
      });
    const ra = mkRunner(() => boardA);
    const rb = mkRunner(() => boardB);
    ra.tick();
    rb.tick();
    await flush(5);
    expect(runs).toHaveLength(1);

    // Releasing the held run frees the single shared slot; once board B is
    // nudged again it claims it.
    release();
    await flush();
    rb.tick();
    await flush();
    expect(runs).toHaveLength(2);
  });
});
