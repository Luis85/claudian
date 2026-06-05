import { Notice, TFile, TFolder } from 'obsidian';

import { EventBus } from '@/core/events/EventBus';
import type { UsageEventMap } from '@/core/usage/events';
import { runQuickActionForFile } from '@/features/quickActions/runQuickActionForFile';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

const MOCK_ACTION: QuickAction = {
  id: 'act',
  name: 'Summarize',
  description: 'Summarize',
  prompt: 'Summarize this.',
  filePath: 'Quick Actions/summarize.md',
};

function makeMockTab(lifecycleState: 'blank' | 'active') {
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
      inputController: { sendMessage: jest.fn() },
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

function makeMockPlugin(tabManager: ReturnType<typeof makeMockTabManager> | null) {
  const view = { getTabManager: jest.fn(() => tabManager) };
  return {
    app: { vault: {} },
    events: { emit: jest.fn() },
    getView: jest.fn(() => view),
    activateView: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('runQuickActionForFile', () => {
  it('reuses a blank active tab, attaches file pill after switch, sends prompt', async () => {
    const tab = makeMockTab('blank');
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true });
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runQuickActionForFile(plugin as any, file, MOCK_ACTION);

    expect(tm.switchToTab).toHaveBeenCalledWith('tab-1');
    expect(tab.ui.fileContextManager.attachFileAsPill).toHaveBeenCalledWith('note.md');
    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledWith({ content: 'Summarize this.' });

    const switchOrder = (tm.switchToTab as jest.Mock).mock.invocationCallOrder[0];
    const attachOrder = (tab.ui.fileContextManager.attachFileAsPill as jest.Mock).mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(attachOrder);
  });

  it('attaches folder pill when given a TFolder', async () => {
    const tab = makeMockTab('blank');
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true });
    const plugin = makeMockPlugin(tm);
    const folder = Object.assign(Object.create(TFolder.prototype), { path: 'docs' });

    await runQuickActionForFile(plugin as any, folder, MOCK_ACTION);

    expect(tab.ui.fileContextManager.attachFolderAsPill).toHaveBeenCalledWith('docs');
  });

  it('creates a new tab when the active tab is not blank', async () => {
    const active = makeMockTab('active');
    const newTab = makeMockTab('blank');
    newTab.id = 'tab-2';
    const tm = makeMockTabManager({ activeTab: active, canCreate: true, newTab });
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runQuickActionForFile(plugin as any, file, MOCK_ACTION);

    expect(tm.createTab).toHaveBeenCalledWith(null, undefined, { activate: false });
    expect(tm.switchToTab).toHaveBeenCalledWith('tab-2');
  });

  it('shows the tab-limit notice when canCreateTab returns false', async () => {
    const active = makeMockTab('active');
    const tm = makeMockTabManager({ activeTab: active, canCreate: false });
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runQuickActionForFile(plugin as any, file, MOCK_ACTION);

    expect(Notice).toHaveBeenCalledWith('quickActions.contextMenu.tabLimitReached');
    expect(tm.switchToTab).not.toHaveBeenCalled();
  });
});

describe('runQuickActionForFile usage emission', () => {
  it('emits usage.recorded with quick-action filename stem after sendMessage resolves', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const tab = makeMockTab('blank');
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true });
    const plugin = { ...makeMockPlugin(tm), events };
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
    const action: QuickAction = {
      id: 'a',
      name: 'Summarize selection',
      description: '',
      prompt: 'p',
      filePath: 'Quick Actions/summarize.md',
    };

    await runQuickActionForFile(plugin as any, file, action);

    expect(recorded).toEqual([{ kind: 'quickAction', name: 'summarize' }]);
  });

  it('does NOT emit if sendMessage rejects', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const tab = makeMockTab('blank');
    tab.controllers.inputController.sendMessage = jest.fn().mockRejectedValue(new Error('send failed'));
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true });
    const plugin = { ...makeMockPlugin(tm), events };
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await expect(
      runQuickActionForFile(plugin as any, file, MOCK_ACTION),
    ).rejects.toThrow('send failed');
    expect(recorded).toEqual([]);
  });

  it('does NOT emit on early return (no view)', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const plugin = {
      app: { vault: {} },
      events,
      getView: jest.fn(() => null),
      activateView: jest.fn().mockResolvedValue(undefined),
    };
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runQuickActionForFile(plugin as any, file, MOCK_ACTION);
    expect(recorded).toEqual([]);
  });
});
