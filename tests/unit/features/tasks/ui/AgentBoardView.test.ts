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
