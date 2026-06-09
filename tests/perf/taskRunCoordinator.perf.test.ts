/**
 * Work-order run coordination scaling guard rails.
 *
 * Two durable contracts:
 *
 *   1. `TaskRunCoordinator.run()` does constant validation work per launch —
 *      the provider/model eligibility predicates are consulted exactly once,
 *      no matter how many other runs are in flight (the active-run guard is a
 *      Set/Map lookup, never an iteration over live runs). A duplicate launch
 *      of an already-active card is rejected before any predicate runs.
 *
 *   2. A `QueueRunner` drain pass (multi-slot) is bounded by capacity and
 *      runnable cards, never by total board size: launches per tick ≤ free
 *      slots, and the eligibility probe count is identical whether the board
 *      holds 200 or 2000 (mostly terminal) work orders.
 *
 * `queueRunner.perf` covers the capacity-1 predicate scan; this spec covers
 * multi-slot drain and the coordinator itself. Timings are reported, never
 * asserted.
 */
import { QueueRunner } from '@/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '@/features/tasks/execution/QueueSlotTracker';
import type { TaskRunResult } from '@/features/tasks/execution/TaskRunCoordinator';
import { TaskRunCoordinator } from '@/features/tasks/execution/TaskRunCoordinator';
import type { TaskSpec } from '@/features/tasks/model/taskTypes';

import { reportMetrics, timeMs } from './perfReport';

function makeTask(id: string, status: 'ready' | 'done'): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id,
      title: id,
      status,
      priority: '2 - normal',
      created: '2026-06-01T00:00:00Z',
      updated: '2026-06-01T00:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      attempts: 0,
    },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  };
}

interface CoordinatorProbe {
  coordinator: TaskRunCoordinator;
  counters: { providerChecks: number; modelChecks: number };
}

function makeCoordinator(): CoordinatorProbe {
  const counters = { providerChecks: 0, modelChecks: 0 };
  const coordinator = new TaskRunCoordinator({
    executionSurface: {
      // Never settles: the run stays in flight for the whole test, holding its
      // registry reservation like a real long-running provider turn.
      startTaskRun: () => new Promise(() => {}),
    } as never,
    events: { emit: () => {}, on: () => () => {} } as never,
    now: () => '2026-06-01T00:00:00Z',
    isProviderEnabled: () => {
      counters.providerChecks += 1;
      return true;
    },
    ownsModel: () => {
      counters.modelChecks += 1;
      return true;
    },
    writeTaskStatus: async () => {},
    writeHeartbeat: async () => {},
    appendLedger: async () => {},
    finalizeLedgerToNote: async () => {},
    writeHandoff: async () => {},
    renderPrompt: () => 'prompt',
  });
  return { coordinator, counters };
}

/**
 * Launches `activeCount` never-settling runs, then measures the validation
 * work for one additional launch and for one duplicate-launch rejection.
 */
async function launchCost(activeCount: number): Promise<{
  checksForNextLaunch: number;
  checksForDuplicate: number;
  launchMs: number;
}> {
  const { coordinator, counters } = makeCoordinator();
  for (let i = 0; i < activeCount; i++) {
    // Floating by design: startTaskRun never settles, so the run stays active.
    void coordinator.run(makeTask(`active-${i}`, 'ready'));
  }
  // run() validates + reserves synchronously before its first await.
  expect(coordinator.isActive('active-0')).toBe(true);
  expect(coordinator.isActive(`active-${activeCount - 1}`)).toBe(true);

  counters.providerChecks = 0;
  counters.modelChecks = 0;
  let launchMs = 0;
  await new Promise<void>((resolve) => {
    launchMs = timeMs(() => {
      void coordinator.run(makeTask('next', 'ready'));
      resolve();
    });
  });
  const checksForNextLaunch = counters.providerChecks + counters.modelChecks;

  counters.providerChecks = 0;
  counters.modelChecks = 0;
  const duplicate = await coordinator.run(makeTask('active-0', 'ready'));
  expect(duplicate.ok).toBe(false);
  const checksForDuplicate = counters.providerChecks + counters.modelChecks;

  return { checksForNextLaunch, checksForDuplicate, launchMs };
}

interface DrainProbe {
  isActiveProbes: number;
  launches: number;
  tickMs: number;
}

/** One QueueRunner drain pass over `total` cards (`runnable` ready) with `cap` slots. */
function drainPass(total: number, runnable: number, cap: number): DrainProbe {
  const tasks: TaskSpec[] = [];
  for (let i = 0; i < total; i++) {
    tasks.push(makeTask(`t${i}`, i < runnable ? 'ready' : 'done'));
  }
  let isActiveProbes = 0;
  const slot = new QueueSlotTracker(cap);
  const runner = new QueueRunner({
    slot,
    getTasks: () => tasks,
    eligibility: {
      isProviderEnabled: () => true,
      ownsModel: () => true,
      isActive: () => {
        isActiveProbes += 1;
        return false;
      },
    },
    coordinator: {
      run: () => new Promise<TaskRunResult>(() => {}),
      isActive: () => false,
    },
    appendLedger: async () => {},
    events: { emit: () => {}, on: () => () => {} },
    haltAfterFailures: 3,
    initialPaused: false,
    now: () => Date.now(),
  });
  const tickMs = timeMs(() => runner.tick());
  // Slots acquired synchronously inside the tick = launches this pass.
  return { isActiveProbes, launches: slot.occupied(), tickMs };
}

describe('TaskRunCoordinator + queue drain scaling', () => {
  it('validates a launch with O(1) predicate work regardless of active-run count', async () => {
    const scales = [5, 50, 500];
    const metrics = [];
    const results = [];
    for (const n of scales) {
      const r = await launchCost(n);
      results.push({ n, ...r });
      metrics.push({
        n,
        values: {
          checksForNextLaunch: r.checksForNextLaunch,
          checksForDuplicate: r.checksForDuplicate,
          launchMs: Math.round(r.launchMs * 1000) / 1000,
        },
      });
    }

    reportMetrics('TaskRunCoordinator — validation work vs active runs', metrics);

    for (const r of results) {
      // Exactly one provider check + one model check per launch — never a scan
      // over the n already-active runs.
      expect(r.checksForNextLaunch).toBe(2);
      // Duplicate launch short-circuits on the registry before any predicate.
      expect(r.checksForDuplicate).toBe(0);
    }
  });

  it('bounds drain-pass launches by slot capacity, not runnable count', () => {
    const cap = 4;
    const metrics = [
      { total: 200, runnable: 10 },
      { total: 1000, runnable: 100 },
      { total: 1000, runnable: 1000 },
    ].map(({ total, runnable }) => {
      const probe = drainPass(total, runnable, cap);
      return {
        n: total,
        probe,
        runnable,
        values: {
          runnable,
          launches: probe.launches,
          isActiveProbes: probe.isActiveProbes,
          tickMs: Math.round(probe.tickMs * 1000) / 1000,
        },
      };
    });

    reportMetrics(`Queue drain — launches/probes vs board size (cap ${cap})`, metrics);

    for (const m of metrics) {
      expect(m.probe.launches).toBe(Math.min(cap, m.runnable));
      // Per-pick eligibility probes visit runnable candidates only, so a pass is
      // bounded by cap × runnable — never by total board size.
      expect(m.probe.isActiveProbes).toBeLessThanOrEqual(cap * m.runnable);
    }
  });

  it('keeps drain-pass eligibility probes independent of terminal-card count', () => {
    const cap = 4;
    const runnable = 10;
    const small = drainPass(200, runnable, cap);
    const large = drainPass(2000, runnable, cap);

    reportMetrics('Queue drain — probe invariance vs terminal cards', [
      { n: 200, values: { isActiveProbes: small.isActiveProbes, launches: small.launches } },
      { n: 2000, values: { isActiveProbes: large.isActiveProbes, launches: large.launches } },
    ]);

    // 1800 extra done cards must contribute zero predicate work to the pass.
    expect(large.isActiveProbes).toBe(small.isActiveProbes);
    expect(large.launches).toBe(small.launches);
  });
});
