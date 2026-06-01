import { PluginViewActivator } from '@/app/views/PluginViewActivator';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type ClaudianPlugin from '@/main';

function createPlugin(opts: {
  existingViewLeaves?: unknown[];
  hasLiveView?: boolean;
  tabManager?: { canCreateTab?: () => boolean } | null;
  lastKnownOpenTabCount?: number;
  maxTabs?: number;
  placement?: 'main-tab' | 'left-sidebar' | 'right-sidebar';
} = {}) {
  const leaves = opts.existingViewLeaves ?? [];
  const view = opts.hasLiveView
    ? { getTabManager: () => opts.tabManager ?? null, createNewTab: jest.fn().mockResolvedValue(undefined) }
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
      maxTabs: opts.maxTabs ?? 3,
    },
    getView: jest.fn().mockReturnValue(view),
    lastKnownTabManagerState: { openTabs: new Array(opts.lastKnownOpenTabCount ?? 0).fill({}) },
  } as unknown as ClaudianPlugin;
  return { plugin, newLeafTab };
}

describe('PluginViewActivator.canCreateNewTab', () => {
  it('uses tabManager.canCreateTab when a live view exists', () => {
    const { plugin } = createPlugin({
      hasLiveView: true,
      tabManager: { canCreateTab: () => false },
    });
    const activator = new PluginViewActivator(plugin);
    expect(activator.canCreateNewTab()).toBe(false);
  });

  it('honors maxTabs clamp [3,10] when relying on last-known state', () => {
    const { plugin } = createPlugin({ lastKnownOpenTabCount: 9, maxTabs: 12 });
    const activator = new PluginViewActivator(plugin);
    // clamp = min(10, max(3, 12)) = 10; 9 < 10
    expect(activator.canCreateNewTab()).toBe(true);
  });

  it('clamps minimum to 3', () => {
    const { plugin } = createPlugin({ lastKnownOpenTabCount: 2, maxTabs: 1 });
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
    // Three getView() calls: 1 in openNewTab, 2 in ensureViewOpen (before/after activateView)
    (plugin.getView as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(liveView);
    const activator = new PluginViewActivator(plugin);

    await activator.openNewTab();

    expect(liveView.createNewTab).not.toHaveBeenCalled();
    expect(newLeafTab.setViewState).toHaveBeenCalled();
  });
});
