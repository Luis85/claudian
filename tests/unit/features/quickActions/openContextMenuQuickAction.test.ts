import { Notice, TFile, TFolder } from 'obsidian';

import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
import type { QuickAction } from '@/features/quickActions/types';

// ---- Mocks ----------------------------------------------------------------

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

jest.mock('@/core/storage/VaultFileAdapter', () => ({
  VaultFileAdapter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@/features/quickActions/QuickActionStorage', () => ({
  QuickActionStorage: jest.fn().mockImplementation(() => ({})),
}));

// Capture the onRun callback passed to QuickActionsModal so tests can invoke it.
let capturedOnRun: ((action: QuickAction) => void) | null = null;

jest.mock('@/features/quickActions/ui/QuickActionsModal', () => ({
  QuickActionsModal: jest.fn().mockImplementation((_app: unknown, callbacks: { onRun: (action: QuickAction) => void }) => {
    capturedOnRun = callbacks.onRun;
    return { open: jest.fn() };
  }),
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

// The helper's onRun callback wraps async work in `void (async () => {...})()`,
// so awaiting capturedOnRun only flushes one microtask. Tests that observe
// state reached after multiple inner awaits need to drain the queue.
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

// ---- Helpers ---------------------------------------------------------------

const MOCK_ACTION: QuickAction = {
  id: 'act-1',
  name: 'Summarize',
  description: 'Summarize the note',
  prompt: 'Summarize this.',
  filePath: 'Quick Actions/summarize.md',
};

function makeMockTab(lifecycleState: 'blank' | 'bound_cold' | 'active') {
  return {
    id: 'tab-1',
    lifecycleState,
    ui: {
      fileContextManager: {
        attachFileAsPill: jest.fn(),
        attachFolderAsPill: jest.fn(),
      },
    },
    controllers: {
      inputController: {
        sendMessage: jest.fn(),
      },
    },
  };
}

function makeMockTabManager(opts: {
  activeTab: ReturnType<typeof makeMockTab> | null;
  canCreate: boolean;
  newTab?: ReturnType<typeof makeMockTab> | null;
}) {
  return {
    getActiveTab: jest.fn(() => opts.activeTab),
    canCreateTab: jest.fn(() => opts.canCreate),
    createTab: jest.fn().mockResolvedValue(opts.newTab ?? null),
    switchToTab: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockPlugin(
  tabManager: ReturnType<typeof makeMockTabManager> | null,
  viewExists = true,
) {
  const view = viewExists
    ? { getTabManager: jest.fn(() => tabManager) }
    : null;

  return {
    app: { vault: {} },
    settings: { quickActionsFolder: 'Quick Actions' },
    getView: jest.fn(() => view),
    activateView: jest.fn().mockResolvedValue(undefined),
  };
}

// ---- Tests -----------------------------------------------------------------

beforeEach(() => {
  capturedOnRun = null;
  jest.clearAllMocks();
});

describe('openContextMenuQuickAction', () => {
  it('opens QuickActionsModal', async () => {
    const activeTab = makeMockTab('blank');
    const tabManager = makeMockTabManager({ activeTab, canCreate: true });
    const plugin = makeMockPlugin(tabManager);

    await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);

    const { QuickActionsModal } = jest.requireMock('@/features/quickActions/ui/QuickActionsModal');
    expect(QuickActionsModal).toHaveBeenCalledTimes(1);
  });

  describe('onRun tab selection', () => {
    it('reuses blank active tab', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      await capturedOnRun!(MOCK_ACTION);

      expect(tabManager.createTab).not.toHaveBeenCalled();
      expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-1');
    });

    it('creates new tab when active tab has a conversation', async () => {
      const activeTab = makeMockTab('active');
      const newTab = makeMockTab('blank');
      newTab.id = 'tab-2';
      const tabManager = makeMockTabManager({ activeTab, canCreate: true, newTab });
      const plugin = makeMockPlugin(tabManager);

      await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      await capturedOnRun!(MOCK_ACTION);

      expect(tabManager.createTab).toHaveBeenCalledWith(null, undefined, { activate: false });
      expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-2');
    });

    it('shows Notice and aborts when canCreateTab is false', async () => {
      const activeTab = makeMockTab('active');
      const tabManager = makeMockTabManager({ activeTab, canCreate: false });
      const plugin = makeMockPlugin(tabManager);

      await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      await capturedOnRun!(MOCK_ACTION);

      expect(Notice).toHaveBeenCalledWith('quickActions.contextMenu.tabLimitReached');
      expect(tabManager.switchToTab).not.toHaveBeenCalled();
    });

    it('shows Notice and aborts when createTab returns null', async () => {
      const activeTab = makeMockTab('active');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true, newTab: null });
      const plugin = makeMockPlugin(tabManager);

      await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      await capturedOnRun!(MOCK_ACTION);

      expect(Notice).toHaveBeenCalledWith('quickActions.contextMenu.tabLimitReached');
      expect(tabManager.switchToTab).not.toHaveBeenCalled();
    });
  });

  describe('onRun chip injection', () => {
    it('attaches file pill for TFile', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      const file = Object.assign(Object.create(TFile.prototype), { path: 'docs/my-note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);

      expect(activeTab.ui.fileContextManager.attachFileAsPill).toHaveBeenCalledWith('docs/my-note.md');
      expect(activeTab.ui.fileContextManager.attachFolderAsPill).not.toHaveBeenCalled();
    });

    it('attaches folder pill for TFolder', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      const folder = Object.assign(Object.create(TFolder.prototype), { path: 'docs' });
      await openContextMenuQuickAction(plugin as any, folder);
      await capturedOnRun!(MOCK_ACTION);

      expect(activeTab.ui.fileContextManager.attachFolderAsPill).toHaveBeenCalledWith('docs');
      expect(activeTab.ui.fileContextManager.attachFileAsPill).not.toHaveBeenCalled();
    });

    it('attaches pill AFTER switchToTab to survive initializeWelcome reset', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);
      await flushMicrotasks();

      const switchOrder = (tabManager.switchToTab as jest.Mock).mock.invocationCallOrder[0];
      const attachOrder = (activeTab.ui.fileContextManager.attachFileAsPill as jest.Mock).mock.invocationCallOrder[0];
      expect(switchOrder).toBeLessThan(attachOrder);
    });

    it('attaches pill AFTER switchToTab on the new-tab path as well', async () => {
      const activeTab = makeMockTab('active');
      const newTab = makeMockTab('blank');
      newTab.id = 'tab-2';
      const tabManager = makeMockTabManager({ activeTab, canCreate: true, newTab });
      const plugin = makeMockPlugin(tabManager);

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);
      await flushMicrotasks();

      const switchOrder = (tabManager.switchToTab as jest.Mock).mock.invocationCallOrder[0];
      const attachOrder = (newTab.ui.fileContextManager.attachFileAsPill as jest.Mock).mock.invocationCallOrder[0];
      expect(switchOrder).toBeLessThan(attachOrder);
    });
  });

  describe('onRun send', () => {
    it('calls sendMessage with action prompt', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);

      expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
        content: 'Summarize this.',
      });
    });
  });

  describe('onRun view handling', () => {
    it('calls activateView when view is not yet open', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });

      // getView() returns null on first call, then the view on second call
      const view = { getTabManager: jest.fn(() => tabManager) };
      const plugin = {
        app: { vault: {} },
        settings: { quickActionsFolder: 'Quick Actions' },
        getView: jest.fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(view),
        activateView: jest.fn().mockResolvedValue(undefined),
      };

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);
      await flushMicrotasks();

      expect(plugin.activateView).toHaveBeenCalledTimes(1);
      expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalled();
    });

    it('aborts gracefully when view cannot be opened', async () => {
      const plugin = {
        app: { vault: {} },
        settings: { quickActionsFolder: 'Quick Actions' },
        getView: jest.fn().mockReturnValue(null),
        activateView: jest.fn().mockResolvedValue(undefined),
      };

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);

      // No error thrown, no send attempted
      expect(Notice).not.toHaveBeenCalled();
    });
  });
});
