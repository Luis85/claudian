import { PluginViewActivator } from '@/app/views/PluginViewActivator';

function plugin(opts: { chat: number; wo: number; maxChat: number; queueCap: number; reservations?: number }) {
  const tabManager = {
    getTabCount: () => opts.chat + opts.wo,
    countTabsByKind: (k: 'chat' | 'work-order') => (k === 'chat' ? opts.chat : opts.wo),
    canCreateTab: (k: 'chat' | 'work-order' = 'chat') =>
      k === 'chat' ? opts.chat < opts.maxChat : opts.wo < opts.queueCap,
    getAllTabs: () => Array(opts.chat + opts.wo).fill({}),
  };
  return {
    settings: { maxChatTabs: opts.maxChat, agentBoardQueueCap: opts.queueCap },
    chatTabReservations: { pending: opts.reservations ?? 0 },
    getView: () => ({
      areTabsRestored: () => true,
      getTabManager: () => tabManager,
    }),
    app: { workspace: { getLeavesOfType: () => [] } },
    lastKnownTabManagerState: null,
  } as never;
}

describe('chat cap saturation does not stall the queue', () => {
  it('user filling every chat tab leaves WO free slots untouched', () => {
    const activator = new PluginViewActivator(plugin({ chat: 4, wo: 0, maxChat: 4, queueCap: 2 }));
    expect(activator.canCreateNewTab()).toBe(false);
    expect(activator.getTabSlotUsage()).toEqual({ used: 0, max: 2 });
  });

  it('reservations subtract from WO free slots without affecting the chat cap', () => {
    const activator = new PluginViewActivator(
      plugin({ chat: 4, wo: 1, maxChat: 4, queueCap: 3, reservations: 1 }),
    );
    expect(activator.canCreateNewTab()).toBe(false);
    expect(activator.getTabSlotUsage()).toEqual({ used: 2, max: 3 });
  });

  it('WO cap full does not block chat tab creation', () => {
    const activator = new PluginViewActivator(plugin({ chat: 2, wo: 3, maxChat: 5, queueCap: 3 }));
    expect(activator.canCreateNewTab()).toBe(true);
    expect(activator.getTabSlotUsage()).toEqual({ used: 3, max: 3 });
  });

  it('queue cap can drop to 1 (decoupled from chat MIN_TABS=3 floor)', () => {
    const activator = new PluginViewActivator(plugin({ chat: 0, wo: 0, maxChat: 3, queueCap: 1 }));
    expect(activator.getTabSlotUsage()).toEqual({ used: 0, max: 1 });
  });
});
