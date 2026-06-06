import { loadBoardConfig, writeBoardQueuePaused } from '../../../../src/features/tasks/config/BoardConfigStore';

describe('QueueRunner integration — pause persisted', () => {
  it('writeBoardQueuePaused round-trips through loadBoardConfig', () => {
    const settings: Record<string, unknown> = {};
    writeBoardQueuePaused(settings, true);
    expect(loadBoardConfig(settings).config.queue?.paused).toBe(true);

    writeBoardQueuePaused(settings, false);
    expect(loadBoardConfig(settings).config.queue?.paused).toBe(false);
  });
});
