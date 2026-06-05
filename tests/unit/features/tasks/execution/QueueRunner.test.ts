import type { TaskEventMap } from '../../../../../src/features/tasks/events';
import {
  QueueRunner,
  type QueueRunnerCoordinator,
  type QueueRunnerEvents,
} from '../../../../../src/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '../../../../../src/features/tasks/execution/QueueSlotTracker';
import type { EligibilityPredicates } from '../../../../../src/features/tasks/execution/selectNextEligibleTask';
import type { TaskRunResult } from '../../../../../src/features/tasks/execution/TaskRunCoordinator';
import type { TaskLedgerEntry, TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';

function makeTask(id: string, overrides: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    frontmatter: {
      type: 'claudian-work-order',
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

const flush = async (cycles = 6): Promise<void> => {
  for (let i = 0; i < cycles; i++) await new Promise((r) => setTimeout(r, 0));
};

interface HarnessConfig {
  cap?: number;
  initialPaused?: boolean;
  haltAfterFailures?: number;
  now?: () => number;
  eligibility?: Partial<EligibilityPredicates>;
  // Decides each run's outcome (default: success). May return a pending promise
  // the test resolves later to hold the slot.
  onRun?: (task: TaskSpec) => Promise<TaskRunResult> | TaskRunResult;
}

interface Harness {
  runner: QueueRunner;
  slot: QueueSlotTracker;
  runCalls: string[];
  emissions: Array<{ name: keyof TaskEventMap; payload: unknown }>;
  ledger: TaskLedgerEntry[];
  setTasks: (t: TaskSpec[]) => void;
}

// The coordinator removes a card once its run settles and reports in-flight via
// the slot tracker — exactly how the real coordinator's `isActive` set behaves —
// so a completed card never re-enters the Ready pool and re-runs.
function makeHarness(config: HarnessConfig = {}): Harness {
  const slot = new QueueSlotTracker(config.cap ?? 1);
  let tasks: TaskSpec[] = [];
  const runCalls: string[] = [];
  const emissions: Array<{ name: keyof TaskEventMap; payload: unknown }> = [];
  const ledger: TaskLedgerEntry[] = [];

  const coordinator: QueueRunnerCoordinator = {
    run: async (task): Promise<TaskRunResult> => {
      runCalls.push(task.frontmatter.id);
      const fallback: TaskRunResult = { ok: true, status: 'review' };
      const result = await (config.onRun ? config.onRun(task) : fallback);
      tasks = tasks.filter((t) => t.frontmatter.id !== task.frontmatter.id);
      return result;
    },
    isActive: (id) => slot.isHeld(id),
  };

  const events: QueueRunnerEvents = {
    emit: (name, payload) => {
      emissions.push({ name, payload });
    },
    on: () => () => {},
  };

  const runner = new QueueRunner({
    slot,
    getTasks: () => tasks,
    eligibility: {
      isProviderEnabled: () => true,
      ownsModel: () => true,
      isActive: (id) => slot.isHeld(id),
      ...config.eligibility,
    },
    coordinator,
    appendLedger: async (_task, entry) => {
      ledger.push(entry);
    },
    events,
    haltAfterFailures: config.haltAfterFailures ?? 3,
    initialPaused: config.initialPaused ?? false,
    now: config.now ?? (() => Date.now()),
  });

  return {
    runner,
    slot,
    runCalls,
    emissions,
    ledger,
    setTasks: (t) => {
      tasks = t;
    },
  };
}

describe('QueueRunner — paused/halted gates', () => {
  it('does not tick when paused', async () => {
    const h = makeHarness({ initialPaused: true });
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual([]);
  });

  it('does not tick when halted', async () => {
    const h = makeHarness();
    h.runner.setHalted('test halt');
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual([]);
  });

  it('ticks when neither paused nor halted', async () => {
    const h = makeHarness();
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual(['a']);
  });
});

describe('QueueRunner — skip-cascade', () => {
  it('drains skips in a single tick and launches the next eligible card', async () => {
    const h = makeHarness({
      eligibility: { isProviderEnabled: (id) => id === 'claude' },
    });
    h.setTasks([
      makeTask('a', { provider: 'codex' }),
      makeTask('b', { provider: 'codex' }),
      makeTask('c'),
    ]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual(['c']);
    const skipped = h.emissions
      .filter((e) => e.name === 'task:queue-skipped')
      .map((e) => (e.payload as { taskId: string }).taskId);
    expect(skipped).toEqual(['a', 'b']);
  });

  it('emits task:queue-tick when launching', async () => {
    const h = makeHarness();
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await flush();
    const ticks = h.emissions.filter((e) => e.name === 'task:queue-tick');
    expect(ticks).toHaveLength(1);
    expect(ticks[0].payload).toEqual({ taskId: 'a' });
  });

  it('drains sequentially at cap=1', async () => {
    const h = makeHarness();
    h.setTasks([makeTask('a'), makeTask('b')]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual(['a', 'b']);
  });

  it('launches up to cap concurrently when cap > 1', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = makeHarness({
      cap: 2,
      onRun: async () => {
        await hold;
        return { ok: true, status: 'review' };
      },
    });
    h.setTasks([makeTask('a'), makeTask('b'), makeTask('c')]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual(['a', 'b']);
    expect(h.slot.occupied()).toBe(2);
    release();
    await flush();
    expect(h.runCalls).toEqual(['a', 'b', 'c']);
  });
});

describe('QueueRunner — halt threshold', () => {
  it('halts after N consecutive failures', async () => {
    const h = makeHarness({
      haltAfterFailures: 2,
      onRun: () => ({ ok: false, error: 'boom' }),
    });
    h.setTasks([makeTask('a'), makeTask('b'), makeTask('c')]);
    h.runner.tick();
    await flush();
    expect(h.runner.isHalted()).toBe(true);
    expect(h.emissions.filter((e) => e.name === 'task:queue-halted')).toHaveLength(1);
  });

  it('resets counter on success', async () => {
    let count = 0;
    const h = makeHarness({
      haltAfterFailures: 3,
      onRun: () => {
        count += 1;
        return count === 2 ? { ok: true, status: 'review' } : { ok: false, error: 'boom' };
      },
    });
    h.setTasks([makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')]);
    h.runner.tick();
    await flush();
    expect(h.runner.isHalted()).toBe(false);
  });

  it('clearHalt resets state and lets next tick run', async () => {
    const h = makeHarness({
      haltAfterFailures: 1,
      onRun: () => ({ ok: false, error: 'boom' }),
    });
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await flush();
    expect(h.runner.isHalted()).toBe(true);
    h.runner.clearHalt();
    expect(h.runner.isHalted()).toBe(false);
  });
});

describe('QueueRunner — pause/resume', () => {
  it('setPaused(true) emits paused event and blocks ticks', async () => {
    const h = makeHarness();
    h.setTasks([makeTask('a')]);
    h.runner.setPaused(true);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual([]);
    expect(h.emissions.some((e) => e.name === 'task:queue-paused')).toBe(true);
  });

  it('setPaused(false) emits resumed event and ticks immediately', async () => {
    const h = makeHarness({ initialPaused: true });
    h.setTasks([makeTask('a')]);
    h.runner.setPaused(false);
    await flush();
    expect(h.runCalls).toEqual(['a']);
    expect(h.emissions.some((e) => e.name === 'task:queue-resumed')).toBe(true);
  });
});

describe('QueueRunner — skip ledger debounce', () => {
  it('writes the ledger entry once per 60s for the same (task, reason)', async () => {
    let nowMs = 1_000_000;
    const h = makeHarness({
      eligibility: { isProviderEnabled: () => false },
      now: () => nowMs,
    });
    h.setTasks([makeTask('a')]);

    h.runner.tick();
    await flush();
    expect(h.ledger).toHaveLength(1);

    h.runner.tick();
    await flush();
    expect(h.ledger).toHaveLength(1);

    nowMs += 60_001;
    h.runner.tick();
    await flush();
    expect(h.ledger).toHaveLength(2);
  });

  it('writes a fresh ledger entry when the reason changes', async () => {
    let providerEnabled = false;
    const h = makeHarness({
      eligibility: { isProviderEnabled: () => providerEnabled, ownsModel: () => false },
    });
    h.setTasks([makeTask('a')]);

    h.runner.tick();
    await flush();
    expect(h.ledger).toHaveLength(1);

    providerEnabled = true;
    h.runner.tick();
    await flush();
    expect(h.ledger).toHaveLength(2);
    expect(h.ledger[1].message).toContain('model');
  });
});

describe('QueueRunner — dispose', () => {
  it('dispose prevents further ticks', async () => {
    const h = makeHarness();
    h.runner.dispose();
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual([]);
  });
});
