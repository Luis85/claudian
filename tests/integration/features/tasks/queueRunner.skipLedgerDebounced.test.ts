import { QueueRunner } from '../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../src/features/tasks/execution/QueueSlotTracker';
import { flush, makeTask } from './queueRunnerKit';

describe('QueueRunner integration — skip ledger debounce', () => {
  it('writes one ledger entry per (task, reason) within 60s', async () => {
    let nowMs = 100_000;
    const ledger: string[] = [];
    const tasks = [makeTask('a', { provider: 'codex', model: 'gpt-5' })];
    const runner = new QueueRunner({
      slot: new QueueSlotTracker(1),
      getTasks: () => tasks,
      eligibility: { isProviderEnabled: () => false, ownsModel: () => true, isActive: () => false },
      coordinator: { run: async () => ({ ok: true, status: 'review' }), isActive: () => false },
      appendLedger: async (_task, entry) => {
        ledger.push(entry.message);
      },
      events: { emit: () => {}, on: () => () => {} },
      haltAfterFailures: 3,
      initialPaused: false,
      now: () => nowMs,
    });
    runner.tick();
    await flush();
    runner.tick();
    await flush();
    expect(ledger).toHaveLength(1);

    nowMs += 60_001;
    runner.tick();
    await flush();
    expect(ledger).toHaveLength(2);
  });
});
