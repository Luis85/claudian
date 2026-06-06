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
