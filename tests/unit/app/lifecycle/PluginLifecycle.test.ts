import { PluginLifecycle } from '@/app/lifecycle/PluginLifecycle';
import type { SpecoratorView } from '@/features/chat/SpecoratorView';
import type SpecoratorPlugin from '@/main';
import * as pathUtils from '@/utils/path';

function createTab(opts: { cleanup?: () => Promise<void> | void } = {}) {
  return {
    service: { cleanup: jest.fn(opts.cleanup ?? (() => undefined)) },
  };
}

function createView(tabs: ReturnType<typeof createTab>[]) {
  const tabManager = {
    getAllTabs: jest.fn().mockReturnValue(tabs),
    getPersistedState: jest.fn().mockReturnValue({ openTabs: [] }),
  };
  return {
    getTabManager: jest.fn().mockReturnValue(tabManager),
  } as unknown as SpecoratorView;
}

function createPlugin(views: SpecoratorView[]): SpecoratorPlugin {
  return {
    getAllViews: jest.fn().mockReturnValue(views),
    persistTabManagerState: jest.fn().mockResolvedValue(undefined),
    app: { vault: { on: jest.fn() } },
  } as unknown as SpecoratorPlugin;
}

describe('PluginLifecycle.shutdownActiveRuntimes', () => {
  it('calls cleanup on every tab across every view', () => {
    const tabsA = [createTab(), createTab()];
    const tabsB = [createTab()];
    const plugin = createPlugin([createView(tabsA), createView(tabsB)]);
    const lifecycle = new PluginLifecycle(plugin);

    lifecycle.shutdownActiveRuntimes();

    for (const tab of [...tabsA, ...tabsB]) {
      expect(tab.service.cleanup).toHaveBeenCalledTimes(1);
    }
  });

  it('swallows cleanup errors and keeps tearing down remaining tabs', () => {
    const throwingTab = createTab({ cleanup: () => { throw new Error('boom'); } });
    const okTab = createTab();
    const plugin = createPlugin([createView([throwingTab, okTab])]);
    const lifecycle = new PluginLifecycle(plugin);

    expect(() => lifecycle.shutdownActiveRuntimes()).not.toThrow();
    expect(okTab.service.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('PluginLifecycle.persistOpenTabStates', () => {
  it('saves state for every view in parallel', async () => {
    const viewA = createView([]);
    const viewB = createView([]);
    const plugin = createPlugin([viewA, viewB]);
    const lifecycle = new PluginLifecycle(plugin);

    await lifecycle.persistOpenTabStates();

    expect(plugin.persistTabManagerState).toHaveBeenCalledTimes(2);
  });
});

describe('PluginLifecycle.installGitWatcher', () => {
  afterEach(() => jest.restoreAllMocks());

  it('no-ops when getVaultPath returns null', () => {
    jest.spyOn(pathUtils, 'getVaultPath').mockReturnValue(null as unknown as string);
    const plugin = {
      gitStatusWatcher: null,
      registerEvent: jest.fn(),
      app: { vault: { on: jest.fn() } },
    } as unknown as SpecoratorPlugin;
    const lifecycle = new PluginLifecycle(plugin);

    lifecycle.installGitWatcher();

    expect(plugin.gitStatusWatcher).toBeNull();
    expect(plugin.registerEvent).not.toHaveBeenCalled();
  });
});
