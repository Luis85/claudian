import type { TaskEventMap } from '../../../../../src/features/tasks/events';
import {
  createQueueControlState,
  type QueueControlState,
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
  getFreeExecutionSlots?: () => number;
  control?: QueueControlState;
  reloadTask?: (task: TaskSpec) => Promise<TaskSpec | null>;
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
    emit: (name, ...args) => {
      emissions.push({ name, payload: args[0] });
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
    control: config.control,
    now: config.now ?? (() => Date.now()),
    getFreeExecutionSlots: config.getFreeExecutionSlots,
    reloadTask: config.reloadTask,
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

  it('records the skipped card\'s actual status, not a hard-coded ready', async () => {
    // The queue runs both Ready and Needs-fix cards, so a skipped Needs-fix card
    // must log its real status — otherwise the ledger claims it was Ready.
    const h = makeHarness({ eligibility: { isProviderEnabled: () => false } });
    h.setTasks([makeTask('a', { status: 'needs_fix' })]);

    h.runner.tick();
    await flush();

    expect(h.ledger).toHaveLength(1);
    expect(h.ledger[0].status).toBe('needs_fix');
    expect(h.ledger[0].message).toContain('skipped');
  });
});

describe('QueueRunner — pre-launch re-read', () => {
  it('runs the freshly reloaded spec, not the cached one', async () => {
    const seen: string[] = [];
    const h = makeHarness({
      // Disk says the card is now Needs-fix, while the board cached it as Ready.
      reloadTask: async () => makeTask('a', { status: 'needs_fix' }),
      onRun: async (task) => {
        seen.push(task.frontmatter.status);
        return { ok: true, status: 'review' };
      },
    });
    h.setTasks([makeTask('a', { status: 'ready' })]);

    h.runner.tick();
    await flush();

    expect(h.runCalls).toEqual(['a']);
    expect(seen).toEqual(['needs_fix']);
  });

  it('does not launch when the card is no longer runnable on disk', async () => {
    // Race: the user completed the card after the board's last index.
    const h = makeHarness({ reloadTask: async () => makeTask('a', { status: 'done' }) });
    h.setTasks([makeTask('a', { status: 'ready' })]);

    h.runner.tick();
    await flush();

    expect(h.runCalls).toEqual([]);
  });

  it('does not launch when the card is gone on disk', async () => {
    const h = makeHarness({ reloadTask: async () => null });
    h.setTasks([makeTask('a', { status: 'ready' })]);

    h.runner.tick();
    await flush();

    expect(h.runCalls).toEqual([]);
  });

  it('frees the slot on a stale skip so the next tick can run another card', async () => {
    const h = makeHarness({
      cap: 1,
      reloadTask: async (task) =>
        task.frontmatter.id === 'a' ? makeTask('a', { status: 'done' }) : task,
    });
    h.setTasks([makeTask('a', { status: 'ready' }), makeTask('b', { status: 'ready' })]);

    h.runner.tick();
    await flush();
    // 'a' was stale (done on disk) → skipped without running, and its slot freed.
    // The runner does not self-tick on a stale skip (it waits for the re-index
    // event the change raises), so nothing else launched yet.
    expect(h.runCalls).toEqual([]);
    expect(h.slot.occupied()).toBe(0);

    // The board re-indexes after the change and ticks; the freed slot lets 'b' run.
    h.setTasks([makeTask('b', { status: 'ready' })]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual(['b']);
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

describe('QueueRunner — execution slot gate', () => {
  it('does not launch when no chat-tab slot is free', async () => {
    const h = makeHarness({ getFreeExecutionSlots: () => 0 });
    h.setTasks([makeTask('a')]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual([]);
  });

  it('launches at most the number of free execution slots in one drain', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = makeHarness({
      cap: 5,
      getFreeExecutionSlots: () => 2,
      onRun: async () => {
        await hold;
        return { ok: true, status: 'review' };
      },
    });
    h.setTasks([makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')]);
    h.runner.tick();
    await flush();
    expect(h.runCalls).toEqual(['a', 'b']);
    release();
    await flush();
  });
});

describe('QueueRunner — shared control (single brain across panes)', () => {
  it('an auto-halt in one runner halts every runner sharing the control', async () => {
    const control = createQueueControlState();
    const a = makeHarness({ control, haltAfterFailures: 1, onRun: () => ({ ok: false, error: 'boom' }) });
    const b = makeHarness({ control });
    a.setTasks([makeTask('x')]);
    b.setTasks([makeTask('y')]);

    a.runner.tick();
    await flush();
    expect(a.runner.isHalted()).toBe(true);
    expect(b.runner.isHalted()).toBe(true);

    b.runner.tick();
    await flush();
    expect(b.runCalls).toEqual([]);
  });

  it('a pause in one runner pauses every runner sharing the control', async () => {
    const control = createQueueControlState();
    const a = makeHarness({ control });
    const b = makeHarness({ control });
    b.setTasks([makeTask('y')]);

    a.runner.setPaused(true);
    expect(b.runner.isPaused()).toBe(true);

    b.runner.tick();
    await flush();
    expect(b.runCalls).toEqual([]);
  });

  it('shares the consecutive-failure count toward a single halt threshold', async () => {
    const control = createQueueControlState();
    const a = makeHarness({ control, haltAfterFailures: 2, onRun: () => ({ ok: false, error: 'boom' }) });
    const b = makeHarness({ control, haltAfterFailures: 2, onRun: () => ({ ok: false, error: 'boom' }) });
    a.setTasks([makeTask('x')]);
    b.setTasks([makeTask('y')]);

    // One failure in each runner reaches the shared threshold of 2.
    a.runner.tick();
    await flush();
    expect(control.halted).toBe(false);
    b.runner.tick();
    await flush();
    expect(control.halted).toBe(true);
  });

  it('shares the skip-ledger debounce so a card is skipped once per window across panes', async () => {
    const control = createQueueControlState();
    const now = () => 2_000_000;
    const a = makeHarness({ control, now, eligibility: { isProviderEnabled: () => false } });
    const b = makeHarness({ control, now, eligibility: { isProviderEnabled: () => false } });
    a.setTasks([makeTask('x')]);
    b.setTasks([makeTask('x')]);

    a.runner.tick();
    await flush();
    expect(a.ledger).toHaveLength(1);

    // The second pane shares the debounce window via the control, so it does not
    // append a duplicate `queue: skipped` ledger line for the same task/reason.
    b.runner.tick();
    await flush();
    expect(b.ledger).toHaveLength(0);
  });
});
