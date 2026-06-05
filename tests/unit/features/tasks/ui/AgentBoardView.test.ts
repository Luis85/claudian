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
