import { PluginViewActivator } from '../../../../src/app/views/PluginViewActivator';

function fakeTabManager(chat: number, wo: number) {
  return {
    getTabCount: () => chat + wo,
    countTabsByKind: (k: 'chat' | 'work-order') => (k === 'chat' ? chat : wo),
    canCreateTab: (k: 'chat' | 'work-order' = 'chat') => (k === 'chat' ? chat < 4 : wo < 2),
    getAllTabs: () => Array(chat + wo).fill({}),
  };
}

function fakePlugin(opts: {
  chat?: number;
  wo?: number;
  reservations?: number;
  hasView?: boolean;
  restored?: boolean;
  maxChatTabs?: number;
  agentBoardQueueCap?: number;
}) {
  const tabManager = fakeTabManager(opts.chat ?? 0, opts.wo ?? 0);
  return {
    settings: {
      maxChatTabs: opts.maxChatTabs ?? 4,
      agentBoardQueueCap: opts.agentBoardQueueCap ?? 2,
    },
    chatTabReservations: { pending: opts.reservations ?? 0 },
    getView: () =>
      opts.hasView
        ? {
            getTabManager: () => tabManager,
            areTabsRestored: () => opts.restored ?? true,
          }
        : null,
    app: { workspace: { getLeavesOfType: () => [] } },
    lastKnownTabManagerState: null,
  } as never;
}

describe('PluginViewActivator slot accounting', () => {
  it('getTabSlotUsage reports WO usage and queue cap, not totals', () => {
    const activator = new PluginViewActivator(
      fakePlugin({ chat: 4, wo: 1, maxChatTabs: 4, agentBoardQueueCap: 3, hasView: true, restored: true }),
    );
    expect(activator.getTabSlotUsage()).toEqual({ used: 1, max: 3 });
  });

  it('getTabSlotUsage adds outstanding reservations to WO usage', () => {
    const activator = new PluginViewActivator(
      fakePlugin({ chat: 0, wo: 1, reservations: 1, agentBoardQueueCap: 3, hasView: true, restored: true }),
    );
    expect(activator.getTabSlotUsage()).toEqual({ used: 2, max: 3 });
  });

  it('getTabSlotUsage with no view returns only reservations', () => {
    const activator = new PluginViewActivator(
      fakePlugin({ hasView: false, agentBoardQueueCap: 3, reservations: 1 }),
    );
    const usage = activator.getTabSlotUsage();
    expect(usage.used).toBe(1);
    expect(usage.max).toBe(3);
  });
});
