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
