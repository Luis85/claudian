import {
  type OpencodeSessionStatePayload,
  syncOpencodeSessionState,
} from '@/providers/opencode/runtime/opencodeSessionStateSync';

describe('syncOpencodeSessionState', () => {
  it('fans the model/mode-bearing fields into the two syncs', async () => {
    const syncModelState = jest.fn().mockResolvedValue(undefined);
    const syncModeState = jest.fn().mockResolvedValue(undefined);
    const payload: OpencodeSessionStatePayload = {
      configOptions: [{ name: 'opt', value: 'v' } as never],
      models: { currentModelId: 'm' } as never,
      modes: { currentModeId: 'build' } as never,
    };

    await syncOpencodeSessionState(payload, syncModelState, syncModeState);

    expect(syncModelState).toHaveBeenCalledWith({
      configOptions: payload.configOptions,
      models: payload.models,
    });
    expect(syncModeState).toHaveBeenCalledWith({
      configOptions: payload.configOptions,
      modes: payload.modes,
    });
  });

  it('coalesces absent fields to null so the syncs always receive a value', async () => {
    const syncModelState = jest.fn().mockResolvedValue(undefined);
    const syncModeState = jest.fn().mockResolvedValue(undefined);

    await syncOpencodeSessionState({}, syncModelState, syncModeState);

    expect(syncModelState).toHaveBeenCalledWith({ configOptions: null, models: null });
    expect(syncModeState).toHaveBeenCalledWith({ configOptions: null, modes: null });
  });

  it('awaits the model sync before the mode sync', async () => {
    const order: string[] = [];
    const syncModelState = jest.fn().mockImplementation(async () => { order.push('model'); });
    const syncModeState = jest.fn().mockImplementation(async () => { order.push('mode'); });

    await syncOpencodeSessionState({}, syncModelState, syncModeState);

    expect(order).toEqual(['model', 'mode']);
  });
});
