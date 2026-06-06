import { sharedRunRegistry } from '@/features/tasks/execution/activeRunRegistry';
import { createQueueControlState } from '@/features/tasks/execution/QueueRunner';
import { QueueSlotTracker } from '@/features/tasks/execution/QueueSlotTracker';
import { AgentBoardView } from '@/features/tasks/ui/AgentBoardView';

describe('AgentBoardView.onToggleQueue', () => {
  it('pauses the runner before the save-triggered queue wake', async () => {
    const order: string[] = [];
    const view = Object.create(AgentBoardView.prototype) as any;
    view.runner = {
      isPaused: () => false,
      isHalted: () => false,
      clearHalt: jest.fn(),
      setPaused: jest.fn((v: boolean) => order.push(`setPaused:${v}`)),
    };
    view.plugin = {
      settings: {},
      saveSettings: jest.fn(async () => {
        order.push('save');
      }),
    };
    view.refresh = jest.fn(async () => {});

    await view.onToggleQueue();

    // saveSettings() emits a queue wake that ticks every runner, so the pause has
    // to be applied first — otherwise a Ready card can auto-launch during the save,
    // exactly as the user clicks pause.
    expect(order).toEqual(['setPaused:true', 'save']);
    expect(view.runner.setPaused).toHaveBeenCalledWith(true);
  });

  it('marks the queue activated for this session when the user starts it', async () => {
    const view = Object.create(AgentBoardView.prototype) as any;
    const control = createQueueControlState(true);
    view.runner = {
      isPaused: () => true,
      isHalted: () => false,
      clearHalt: jest.fn(),
      setPaused: jest.fn((next: boolean) => {
        control.paused = next;
        if (!next) control.sessionActivated = true;
      }),
    };
    view.plugin = {
      settings: {},
      queueControl: control,
      saveSettings: jest.fn(async () => {}),
    };
    view.refresh = jest.fn(async () => {});

    await view.onToggleQueue();

    expect(control.sessionActivated).toBe(true);
    expect(view.runner.setPaused).toHaveBeenCalledWith(false);
  });
});

describe('AgentBoardView.onQueueCapChanged', () => {
  it('applies the live halt threshold and ticks on a settings wake', () => {
    // The wake fires on any settings save. The global cap is applied by the
    // plugin; the per-runner halt threshold must be synced here too, or a
    // changed limit only takes effect on the next board refresh.
    const setHaltAfterFailures = jest.fn();
    const tick = jest.fn();
    const view = Object.create(AgentBoardView.prototype) as any;
    view.runner = { setHaltAfterFailures, tick };
    view.plugin = { settings: { agentBoardQueueHaltAfter: 5 } };

    view.onQueueCapChanged();

    expect(setHaltAfterFailures).toHaveBeenCalledWith(5);
    expect(tick).toHaveBeenCalled();
  });
});

describe('AgentBoardView.recoverOrphanedRuns', () => {
  // Build a minimal view stub wired with enough surface area for
  // recoverOrphanedRuns: a task in a running-ish status with a run_id, a
  // mocked applyNoteChange/noteStore, a runSidecarStore with readHeartbeat,
  // and a stub events emitter.
  function makeView(options: {
    sidecarHeartbeat: { at: string; status: 'running' } | null;
    sidecarThrows?: boolean;
  }): {
    view: any;
    writeStatus: jest.Mock;
    appendLedger: jest.Mock;
    events: { emit: jest.Mock };
  } {
    sharedRunRegistry.clear();
    const writeStatus = jest.fn((content: string) => content);
    const appendLedger = jest.fn((content: string) => content);
    const events = { emit: jest.fn() };
    const view = Object.create(AgentBoardView.prototype) as any;
    view.model = {
      tasks: [
        {
          path: 'tasks/wo.md',
          frontmatter: {
            id: 'wo-1',
            run_id: 'run-1',
            status: 'running',
          },
        },
      ],
      invalidNotes: [],
    };
    view.noteStore = { writeStatus, appendLedger };
    view.pauseState = new Map();
    view.plugin = {
      events,
      runSidecarStore: {
        readHeartbeat: jest.fn(async () => {
          if (options.sidecarThrows) throw new Error('boom');
          return options.sidecarHeartbeat;
        }),
      },
    };
    view.applyNoteChange = jest.fn(async (_path: string, transform: (c: string) => string) => {
      transform('');
    });
    view.refresh = jest.fn(async () => {});
    return { view, writeStatus, appendLedger, events };
  }

  afterEach(() => {
    sharedRunRegistry.clear();
  });

  it('treats a fresh sidecar heartbeat as live and skips orphan adoption', async () => {
    // Sidecar wrote ~2s ago — a previous run touched things very recently, so
    // do not assume the card is orphaned even when no session is in the
    // process-local registry (the "plugin just reloaded" window).
    const { view, writeStatus, appendLedger, events } = makeView({
      sidecarHeartbeat: { at: new Date(Date.now() - 2_000).toISOString(), status: 'running' },
    });

    await view['recoverOrphanedRuns']();

    expect(view.plugin.runSidecarStore.readHeartbeat).toHaveBeenCalledWith('run-1');
    expect(writeStatus).not.toHaveBeenCalled();
    expect(appendLedger).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    expect(view.refresh).not.toHaveBeenCalled();
  });

  it('marks the run failed when neither frontmatter nor sidecar heartbeat is recent', async () => {
    // No sidecar heartbeat at all — there is no signal that a live writer
    // exists, so the orphan adoption path runs and the ledger line lands.
    const { view, writeStatus, appendLedger, events } = makeView({ sidecarHeartbeat: null });

    await view['recoverOrphanedRuns']();

    expect(writeStatus).toHaveBeenCalledTimes(1);
    expect(writeStatus.mock.calls[0][1]).toMatchObject({ status: 'failed' });
    expect(appendLedger).toHaveBeenCalledTimes(1);
    expect(appendLedger.mock.calls[0][1]).toMatchObject({
      status: 'failed',
      message: 'orphaned by plugin reload',
    });
    expect(events.emit).toHaveBeenCalledWith('task:status-changed', {
      taskId: 'wo-1',
      path: 'tasks/wo.md',
      status: 'failed',
    });
    expect(view.refresh).toHaveBeenCalled();
  });

  it('marks the run failed when the sidecar heartbeat is stale', async () => {
    // 10 minutes old, well past the 5-minute stale threshold: no live writer.
    const { view, writeStatus, events } = makeView({
      sidecarHeartbeat: { at: new Date(Date.now() - 10 * 60_000).toISOString(), status: 'running' },
    });

    await view['recoverOrphanedRuns']();

    expect(writeStatus).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      'task:status-changed',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('falls through to recovery when the sidecar read throws', async () => {
    // A corrupt sidecar JSON must not strand the card — prefer recovering it
    // over leaving it in a permanent "running" state with no driver.
    const { view, writeStatus } = makeView({ sidecarHeartbeat: null, sidecarThrows: true });

    await view['recoverOrphanedRuns']();

    expect(writeStatus).toHaveBeenCalledTimes(1);
  });

  it('recovers a running task with no run_id without consulting the sidecar', async () => {
    // A note in `running` status that was never assigned a run_id (e.g. saved
    // mid-run before the first persist) must still be recoverable — the sidecar
    // is keyed on run_id and there's nothing to consult.
    const { view, writeStatus } = makeView({ sidecarHeartbeat: null });
    delete view.model.tasks[0].frontmatter.run_id;

    await view['recoverOrphanedRuns']();

    expect(view.plugin.runSidecarStore.readHeartbeat).not.toHaveBeenCalled();
    expect(writeStatus).toHaveBeenCalledTimes(1);
    expect(writeStatus.mock.calls[0][1]).toMatchObject({ status: 'failed' });
  });

  it('is idempotent: a second call on the same model does not re-recover already-failed cards', async () => {
    // The periodic re-check relies on this contract — a card whose status
    // moved to failed on pass 1 must not get re-written on pass 2.
    const { view, writeStatus } = makeView({ sidecarHeartbeat: null });

    await view['recoverOrphanedRuns']();
    expect(writeStatus).toHaveBeenCalledTimes(1);

    // Mirror what `applyNoteChange` would have done in production: the task's
    // status is now `failed`, so the model entry should reflect that.
    view.model.tasks[0].frontmatter.status = 'failed';

    await view['recoverOrphanedRuns']();
    // Still 1 — the failed card is not in the {running, needs_input,
    // needs_approval} set, so the loop skips it.
    expect(writeStatus).toHaveBeenCalledTimes(1);
  });
});

describe('AgentBoardView.sweepStaleSidecars', () => {
  // Build a minimal view stub wired with enough surface for sweepStaleSidecars:
  // a tasks model, and a runSidecarStore with listRuns + cleanupRun mocked.
  function makeView(options: {
    runIds: string[];
    tasks: Array<{ id: string; status: string; runId?: string }>;
  }) {
    const cleanupRun = jest.fn(async (_runId: string) => {});
    const listRuns = jest.fn(async () => options.runIds);
    const view = Object.create(AgentBoardView.prototype) as any;
    view.model = {
      tasks: options.tasks.map((t) => ({
        path: `tasks/${t.id}.md`,
        frontmatter: { id: t.id, status: t.status, run_id: t.runId },
      })),
      invalidNotes: [],
    };
    view.plugin = {
      runSidecarStore: {
        listRuns,
        cleanupRun,
      },
    };
    return { view, listRuns, cleanupRun };
  }

  it('is a no-op when there are no sidecars', async () => {
    const { view, cleanupRun } = makeView({ runIds: [], tasks: [] });

    await view['sweepStaleSidecars']();

    expect(cleanupRun).not.toHaveBeenCalled();
  });

  it('deletes sidecar dirs whose run_id has no matching active task', async () => {
    // run-a: matches a running task → keep.
    // run-b: matches a `review` task (terminal-ish) → delete.
    // run-c: no task references it at all → delete.
    const { view, cleanupRun } = makeView({
      runIds: ['run-a', 'run-b', 'run-c'],
      tasks: [
        { id: 'wo-a', status: 'running', runId: 'run-a' },
        { id: 'wo-b', status: 'review', runId: 'run-b' },
      ],
    });

    await view['sweepStaleSidecars']();

    expect(cleanupRun).toHaveBeenCalledTimes(2);
    const cleaned = cleanupRun.mock.calls.map((c) => c[0]).sort();
    expect(cleaned).toEqual(['run-b', 'run-c']);
  });

  it('keeps sidecars for every non-terminal status (running, needs_input, needs_approval)', async () => {
    const { view, cleanupRun } = makeView({
      runIds: ['run-r', 'run-i', 'run-p'],
      tasks: [
        { id: 'wo-r', status: 'running', runId: 'run-r' },
        { id: 'wo-i', status: 'needs_input', runId: 'run-i' },
        { id: 'wo-p', status: 'needs_approval', runId: 'run-p' },
      ],
    });

    await view['sweepStaleSidecars']();

    expect(cleanupRun).not.toHaveBeenCalled();
  });

  it('ignores active tasks with no run_id when deciding what to keep', async () => {
    // An active task with no run_id can't own a sidecar, so an orphan sidecar
    // (run-x) whose id happens to be absent from the task list must still be
    // cleaned up.
    const { view, cleanupRun } = makeView({
      runIds: ['run-x'],
      tasks: [{ id: 'wo-1', status: 'running' }],
    });

    await view['sweepStaleSidecars']();

    expect(cleanupRun).toHaveBeenCalledWith('run-x');
  });
});

describe('AgentBoardView.patchLiveStrip live heartbeat', () => {
  function buildLiveStripView(frontmatterHeartbeat: string | undefined) {
    const patchLiveStrip = jest.fn();
    const view = Object.create(AgentBoardView.prototype) as any;
    view.renderer = { patchLiveStrip };
    view.model = {
      tasks: [{
        path: 'tasks/wo.md',
        frontmatter: {
          id: 'wo-1',
          started: new Date(Date.now() - 5_000).toISOString(),
          heartbeat: frontmatterHeartbeat,
          attempts: 1,
        },
        sections: { ledger: '' },
      }],
    };
    view.liveHeartbeats = new Map<string, string>();
    return { view, patchLiveStrip };
  }

  it('prefers the live heartbeat event timestamp over stale frontmatter', () => {
    // Frontmatter heartbeat is 10 minutes old (would render as very stale).
    // A live event fired ~1s ago should make the rendered age small.
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const { view, patchLiveStrip } = buildLiveStripView(stale);
    view.liveHeartbeats.set('wo-1', new Date(Date.now() - 1_000).toISOString());

    view.patchLiveStrip('wo-1');

    const payload = patchLiveStrip.mock.calls[0][1] as { heartbeatAgeMs: number };
    expect(payload.heartbeatAgeMs).toBeLessThan(5_000);
    expect(payload.heartbeatAgeMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to frontmatter heartbeat when no live tick has been captured', () => {
    const stamp = new Date(Date.now() - 30_000).toISOString();
    const { view, patchLiveStrip } = buildLiveStripView(stamp);

    view.patchLiveStrip('wo-1');

    const payload = patchLiveStrip.mock.calls[0][1] as { heartbeatAgeMs: number };
    expect(payload.heartbeatAgeMs).toBeGreaterThanOrEqual(29_000);
    expect(payload.heartbeatAgeMs).toBeLessThan(35_000);
  });
});

describe('AgentBoardView.onStatusChanged liveHeartbeat eviction', () => {
  function buildEvictView() {
    const view = Object.create(AgentBoardView.prototype) as any;
    view.pauseState = new Map();
    view.liveHeartbeats = new Map<string, string>([['wo-1', '2026-06-06T00:00:00Z']]);
    view.patchCard = jest.fn();
    return view;
  }

  it.each(['review', 'done', 'failed', 'canceled'] as const)(
    'drops the live heartbeat entry on terminal status %s',
    (status) => {
      const view = buildEvictView();
      view.onStatusChanged({ taskId: 'wo-1', status });
      expect(view.liveHeartbeats.has('wo-1')).toBe(false);
    },
  );

  it('keeps the live heartbeat entry on a non-terminal status change', () => {
    const view = buildEvictView();
    view.onStatusChanged({ taskId: 'wo-1', status: 'running' });
    expect(view.liveHeartbeats.has('wo-1')).toBe(true);
  });
});

describe('AgentBoardView.syncRunner startup pause', () => {
  it('keeps the queue paused on first board mount even when saved queue.paused is false', () => {
    const view = Object.create(AgentBoardView.prototype) as any;
    const control = createQueueControlState(true);
    view.plugin = {
      queueSlotTracker: new QueueSlotTracker(1),
      settings: { agentBoardQueueCap: 1, agentBoardQueueHaltAfter: 3 },
      queueControl: control,
      events: { emit: jest.fn(), on: jest.fn() },
      chatTabReservations: undefined,
    };
    view.model = { tasks: [] };
    view.config = { schemaVersion: 1, lanes: [], queue: { paused: false } };
    view.coordinator = { isActive: jest.fn(), run: jest.fn() };
    view.isProviderEnabled = jest.fn(() => true);
    view.ownsModel = jest.fn(() => true);
    view.applyNoteChange = jest.fn();
    view.reloadTaskFromVault = jest.fn();
    view.freeExecutionSlots = jest.fn(() => 1);

    view.syncRunner();

    expect(view.runner.isPaused()).toBe(true);
    expect(control.sessionActivated).toBe(false);
  });
});
