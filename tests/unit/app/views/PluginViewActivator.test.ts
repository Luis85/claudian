import { PluginViewActivator } from '@/app/views/PluginViewActivator';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type ClaudianPlugin from '@/main';

function createPlugin(opts: {
  existingViewLeaves?: unknown[];
  hasLiveView?: boolean;
  tabManager?: {
    canCreateTab?: (kind?: 'chat' | 'work-order') => boolean;
    getTabCount?: () => number;
    countTabsByKind?: (kind: 'chat' | 'work-order') => number;
  } | null;
  lastKnownOpenTabCount?: number;
  maxChatTabs?: number;
  agentBoardQueueCap?: number;
  pendingReservations?: number;
  tabsRestored?: boolean;
  placement?: 'main-tab' | 'left-sidebar' | 'right-sidebar';
} = {}) {
  const leaves = opts.existingViewLeaves ?? [];
  const view = opts.hasLiveView
    ? {
        getTabManager: () => opts.tabManager ?? null,
        areTabsRestored: () => opts.tabsRestored ?? true,
        createNewTab: jest.fn().mockResolvedValue(undefined),
      }
    : null;
  const newLeafTab = { setViewState: jest.fn().mockResolvedValue(undefined) };
  const plugin = {
    app: {
      workspace: {
        getLeavesOfType: jest.fn((type: string) =>
          type === VIEW_TYPE_CLAUDIAN ? leaves : [],
        ),
        getLeaf: jest.fn().mockReturnValue(newLeafTab),
        getLeftLeaf: jest.fn().mockReturnValue(newLeafTab),
        getRightLeaf: jest.fn().mockReturnValue(newLeafTab),
        revealLeaf: jest.fn(),
      },
    },
    settings: {
      chatViewPlacement: opts.placement ?? 'main-tab',
      maxChatTabs: opts.maxChatTabs ?? 3,
      agentBoardQueueCap: opts.agentBoardQueueCap ?? 3,
    },
    getView: jest.fn().mockReturnValue(view),
    lastKnownTabManagerState: { openTabs: new Array(opts.lastKnownOpenTabCount ?? 0).fill({}) },
    chatTabReservations: { pending: opts.pendingReservations ?? 0 },
    activateView: jest.fn(),
  } as unknown as ClaudianPlugin;
  return { plugin, newLeafTab };
}

describe('PluginViewActivator.canCreateNewTab', () => {
  it('uses tabManager.canCreateTab("chat") when a live view exists', () => {
    const { plugin } = createPlugin({
      hasLiveView: true,
      tabManager: { canCreateTab: () => false },
    });
    const activator = new PluginViewActivator(plugin);
    expect(activator.canCreateNewTab()).toBe(false);
  });

  it('honors maxChatTabs clamp [3,10] when relying on last-known state', () => {
    const { plugin } = createPlugin({ lastKnownOpenTabCount: 9, maxChatTabs: 12 });
    const activator = new PluginViewActivator(plugin);
    expect(activator.canCreateNewTab()).toBe(true);
  });

  it('clamps minimum to 3', () => {
    const { plugin } = createPlugin({ lastKnownOpenTabCount: 2, maxChatTabs: 1 });
    const activator = new PluginViewActivator(plugin);
    expect(activator.canCreateNewTab()).toBe(true);
  });

  it('returns false when leaves exist but no live view', () => {
    const { plugin } = createPlugin({ existingViewLeaves: [{}] });
    const activator = new PluginViewActivator(plugin);
    expect(activator.canCreateNewTab()).toBe(false);
  });
});

describe('PluginViewActivator.openNewTab', () => {
  it('opens a new tab on the existing view when one is live', async () => {
    const { plugin } = createPlugin({ hasLiveView: true, tabManager: null });
    const activator = new PluginViewActivator(plugin);

    await activator.openNewTab();

    const view = plugin.getView();
    expect(view?.createNewTab).toHaveBeenCalled();
  });

  it('does not stack a tab when restoredTabCount is 0', async () => {
    const { plugin, newLeafTab } = createPlugin({ lastKnownOpenTabCount: 0 });
    const liveView = { createNewTab: jest.fn().mockResolvedValue(undefined), getTabManager: () => null };
    (plugin.getView as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(liveView);
    const activator = new PluginViewActivator(plugin);
    (plugin.activateView as jest.Mock).mockImplementation(() => activator.activateView());

    await activator.openNewTab();

    expect(liveView.createNewTab).not.toHaveBeenCalled();
    expect(newLeafTab.setViewState).toHaveBeenCalled();
  });
});

describe('PluginViewActivator.getTabSlotUsage (work-order budget)', () => {
  it('reports WO tab count and queue cap when a view is mounted', () => {
    const { plugin } = createPlugin({
      hasLiveView: true,
      tabManager: { countTabsByKind: (k) => (k === 'work-order' ? 1 : 4) },
      maxChatTabs: 4,
      agentBoardQueueCap: 3,
    });
    const activator = new PluginViewActivator(plugin);
    expect(activator.getTabSlotUsage()).toEqual({ used: 1, max: 3 });
  });

  it('adds pending reservations to WO usage', () => {
    const { plugin } = createPlugin({
      hasLiveView: true,
      tabManager: { countTabsByKind: (k) => (k === 'work-order' ? 1 : 0) },
      pendingReservations: 2,
      agentBoardQueueCap: 5,
    });
    const activator = new PluginViewActivator(plugin);
    expect(activator.getTabSlotUsage()).toEqual({ used: 3, max: 5 });
  });

  it('clamps WO max to the queue-cap range [1,8]', () => {
    const { plugin } = createPlugin({ agentBoardQueueCap: 99 });
    const activator = new PluginViewActivator(plugin);
    expect(activator.getTabSlotUsage().max).toBe(8);
  });

  it('reports no free capacity while a mounted view is still restoring its tabs', () => {
    const { plugin } = createPlugin({
      hasLiveView: true,
      existingViewLeaves: [{}],
      tabManager: { countTabsByKind: () => 0 },
      tabsRestored: false,
      agentBoardQueueCap: 5,
    });
    const activator = new PluginViewActivator(plugin);
    expect(activator.getTabSlotUsage()).toEqual({ used: 5, max: 5 });
  });

  it('reports no free capacity while a Claudian leaf is mid-mount (no tab manager yet)', () => {
    const { plugin } = createPlugin({
      existingViewLeaves: [{}],
      lastKnownOpenTabCount: 0,
      agentBoardQueueCap: 5,
    });
    const activator = new PluginViewActivator(plugin);
    const usage = activator.getTabSlotUsage();
    expect(usage.max - usage.used).toBe(0);
  });

  it('reports only reservations when no view is mounted (no WO tabs live yet)', () => {
    const { plugin } = createPlugin({
      lastKnownOpenTabCount: 0,
      pendingReservations: 1,
      agentBoardQueueCap: 5,
    });
    const activator = new PluginViewActivator(plugin);
    expect(activator.getTabSlotUsage()).toEqual({ used: 1, max: 5 });
  });

  it('accepts queue cap=1 (below old MIN_TABS=3 floor)', () => {
    const { plugin } = createPlugin({
      hasLiveView: true,
      tabManager: { countTabsByKind: () => 0 },
      agentBoardQueueCap: 1,
    });
    const activator = new PluginViewActivator(plugin);
    expect(activator.getTabSlotUsage()).toEqual({ used: 0, max: 1 });
  });
});
