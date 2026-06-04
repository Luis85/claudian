import { Notice, TFile, TFolder } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { runVaultSkill } from '@/features/quickActions/skills/runVaultSkill';
import type { SkillTabEntry } from '@/features/quickActions/skills/types';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: Record<string, string>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

jest.mock('@/features/chat/tabs/providerResolution', () => ({
  getTabProviderId: jest.fn((tab: { providerId?: string }) => tab.providerId ?? 'claude'),
}));

jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    isEnabled: jest.fn(() => true),
  },
}));

jest.mock('@/core/types/settings', () => ({
  asSettingsBag: (s: unknown) => s as Record<string, unknown>,
}));

function makeEntry(overrides: Partial<SkillTabEntry> = {}): SkillTabEntry {
  return {
    id: 'claude:skill-tdd',
    providerId: 'claude',
    providerDisplayName: 'Claude',
    name: 'tdd',
    description: 'red-green-refactor',
    insertPrefix: '/',
    sourceFilePath: '.claude/skills/tdd/SKILL.md',
    providerEnabled: true,
    ...overrides,
  };
}

function makeTab(opts: { id?: string; providerId?: string; lifecycleState?: string } = {}) {
  return {
    id: opts.id ?? 'tab-1',
    providerId: opts.providerId ?? 'claude',
    lifecycleState: opts.lifecycleState ?? 'blank',
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

function makePlugin(opts: {
  activeTab?: ReturnType<typeof makeTab> | null;
  newTab?: ReturnType<typeof makeTab> | null;
  canCreate?: boolean;
  allTabs?: ReturnType<typeof makeTab>[];
} = {}) {
  const tabManager = {
    getActiveTab: jest.fn(() => opts.activeTab ?? null),
    getAllTabs: jest.fn(() => opts.allTabs ?? (opts.activeTab ? [opts.activeTab] : [])),
    canCreateTab: jest.fn(() => opts.canCreate ?? true),
    createTab: jest.fn().mockResolvedValue(opts.newTab ?? null),
    switchToTab: jest.fn().mockResolvedValue(undefined),
  };
  const view = { getTabManager: jest.fn(() => tabManager) };
  return {
    plugin: {
      app: {},
      settings: {},
      getView: jest.fn(() => view),
      activateView: jest.fn().mockResolvedValue(undefined),
    },
    tabManager,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (ProviderRegistry.isEnabled as jest.Mock).mockReturnValue(true);
});

describe('runVaultSkill', () => {
  it('shows Notice and aborts when provider is disabled at execution', async () => {
    (ProviderRegistry.isEnabled as jest.Mock).mockReturnValue(false);
    const { plugin } = makePlugin();
    await runVaultSkill(plugin as any, makeEntry({ providerEnabled: true }), null);
    expect(Notice).toHaveBeenCalledWith(
      expect.stringContaining('quickActions.skills.providerDisabled'),
    );
  });

  it('re-checks ProviderRegistry.isEnabled and ignores stale providerEnabled=false when provider re-enabled', async () => {
    (ProviderRegistry.isEnabled as jest.Mock).mockReturnValue(true);
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin } = makePlugin({ activeTab });
    await runVaultSkill(plugin as any, makeEntry({ providerEnabled: false }), null);
    expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalled();
  });

  it('aborts silently when view cannot be opened', async () => {
    const plugin = {
      app: {},
      settings: {},
      getView: jest.fn(() => null),
      activateView: jest.fn().mockResolvedValue(undefined),
    };
    await runVaultSkill(plugin as any, makeEntry(), null);
    expect(Notice).not.toHaveBeenCalled();
    expect(plugin.activateView).toHaveBeenCalledTimes(1);
  });

  it('aborts silently when tabManager is null', async () => {
    const view = { getTabManager: jest.fn(() => null) };
    const plugin = {
      app: {},
      settings: {},
      getView: jest.fn(() => view),
      activateView: jest.fn().mockResolvedValue(undefined),
    };
    await runVaultSkill(plugin as any, makeEntry(), null);
    expect(Notice).not.toHaveBeenCalled();
  });

  it('reuses blank active tab when provider matches', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin, tabManager } = makePlugin({ activeTab });
    await runVaultSkill(plugin as any, makeEntry(), null);
    expect(tabManager.createTab).not.toHaveBeenCalled();
    expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-1');
  });

  it('creates new tab with defaultProviderId when active tab provider mismatches', async () => {
    const activeTab = makeTab({ providerId: 'codex', lifecycleState: 'blank' });
    const newTab = makeTab({ id: 'tab-2', providerId: 'claude' });
    const { plugin, tabManager } = makePlugin({ activeTab, newTab });

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(tabManager.createTab).toHaveBeenCalledWith(
      null,
      undefined,
      expect.objectContaining({ activate: false, defaultProviderId: 'claude' }),
    );
    expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-2');
  });

  it('reuses a blank tab on the target provider when active mismatches but blank match exists', async () => {
    const activeTab = makeTab({ id: 'tab-1', providerId: 'codex', lifecycleState: 'bound_active' });
    const blankMatch = makeTab({ id: 'tab-2', providerId: 'claude', lifecycleState: 'blank' });
    const { plugin, tabManager } = makePlugin({
      activeTab,
      allTabs: [activeTab, blankMatch],
    });

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(tabManager.createTab).not.toHaveBeenCalled();
    expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-2');
  });

  it('creates new tab when active matches but is not blank', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'bound_active' });
    const newTab = makeTab({ id: 'tab-2', providerId: 'claude' });
    const { plugin, tabManager } = makePlugin({ activeTab, newTab });

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(tabManager.createTab).toHaveBeenCalledWith(
      null,
      undefined,
      expect.objectContaining({ activate: false, defaultProviderId: 'claude' }),
    );
    expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-2');
  });

  it('shows tab-limit Notice when canCreateTab is false', async () => {
    const activeTab = makeTab({ providerId: 'codex', lifecycleState: 'bound_active' });
    const { plugin, tabManager } = makePlugin({ activeTab, canCreate: false });

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(Notice).toHaveBeenCalledWith('quickActions.contextMenu.tabLimitReached');
    expect(tabManager.switchToTab).not.toHaveBeenCalled();
  });

  it('attaches file pill AFTER switchToTab', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin, tabManager } = makePlugin({ activeTab });
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runVaultSkill(plugin as any, makeEntry(), file as TFile);

    expect(activeTab.ui.fileContextManager.attachFileAsPill).toHaveBeenCalledWith('note.md');
    const switchOrder = (tabManager.switchToTab as jest.Mock).mock.invocationCallOrder[0];
    const attachOrder = (activeTab.ui.fileContextManager.attachFileAsPill as jest.Mock)
      .mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(attachOrder);
  });

  it('attaches folder pill for TFolder', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin } = makePlugin({ activeTab });
    const folder = Object.assign(Object.create(TFolder.prototype), { path: 'docs' });

    await runVaultSkill(plugin as any, makeEntry(), folder as TFolder);

    expect(activeTab.ui.fileContextManager.attachFolderAsPill).toHaveBeenCalledWith('docs');
  });

  it('sends `${insertPrefix}${name}` to the target tab', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin } = makePlugin({ activeTab });
    await runVaultSkill(plugin as any, makeEntry({ name: 'brainstorming' }), null);
    expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: '/brainstorming',
    });
  });

  it('sends with $ prefix for Codex skills', async () => {
    const activeTab = makeTab({ providerId: 'codex', lifecycleState: 'blank' });
    const { plugin } = makePlugin({ activeTab });
    const entry = makeEntry({
      providerId: 'codex',
      providerDisplayName: 'Codex',
      insertPrefix: '$',
      name: 'my-codex',
    });
    await runVaultSkill(plugin as any, entry, null);
    expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: '$my-codex',
    });
  });

  it('activates the view if no view is open', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const tabManager = {
      getActiveTab: jest.fn(() => activeTab),
      getAllTabs: jest.fn(() => [activeTab]),
      canCreateTab: jest.fn(() => true),
      createTab: jest.fn(),
      switchToTab: jest.fn().mockResolvedValue(undefined),
    };
    const view = { getTabManager: jest.fn(() => tabManager) };
    const plugin = {
      app: {},
      getView: jest.fn().mockReturnValueOnce(null).mockReturnValueOnce(view),
      activateView: jest.fn().mockResolvedValue(undefined),
    };

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(plugin.activateView).toHaveBeenCalledTimes(1);
    expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalled();
  });
});
