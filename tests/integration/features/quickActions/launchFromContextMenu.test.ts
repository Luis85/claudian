/**
 * @jest-environment jsdom
 */

import '../../../setup/obsidianDom';

import { TFile } from 'obsidian';

jest.mock('obsidian', () => {
  class Modal {
    contentEl = document.createElement('div');
    modalEl = document.createElement('div');
    titleEl = document.createElement('div');
    scope = { register: jest.fn() };
    constructor(public app: unknown) {}
    open(): void {
      document.body.appendChild(this.contentEl);
      this.onOpen();
    }
    close(): void {
      this.onClose();
      this.contentEl.remove();
    }
    onOpen(): void {}
    onClose(): void {}
  }
  return {
    Modal,
    Notice: jest.fn(),
    TFile: class TFile { path = ''; },
    TFolder: class TFolder { path = ''; },
  };
});

jest.mock('@/i18n/i18n', () => {
  const en = jest.requireActual('@/i18n/locales/en.json');
  return {
    t: (key: string, vars?: Record<string, string>): string => {
      const parts = key.split('.');
      let cur: unknown = en;
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          cur = key;
          break;
        }
      }
      let out = typeof cur === 'string' ? cur : key;
      if (vars) {
        out = Object.entries(vars).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          out,
        );
      }
      return out;
    },
  };
});

const isEnabledMock = jest.fn().mockReturnValue(true);
const getRegisteredMock = jest.fn().mockReturnValue(['claude', 'codex']);
const getChatUIConfigMock = jest.fn().mockImplementation((id: string) => ({
  getModelOptions: () => (id === 'claude'
    ? [{ value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' }]
    : [{ value: 'gpt-5-codex', label: 'gpt-5-codex' }]),
}));
const getProviderDisplayNameMock = jest.fn().mockImplementation((id: string) => id);
jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    isEnabled: (...a: unknown[]) => isEnabledMock(...a),
    getRegisteredProviderIds: () => getRegisteredMock(),
    getChatUIConfig: (...a: unknown[]) => getChatUIConfigMock(...a),
    getProviderDisplayName: (...a: unknown[]) => getProviderDisplayNameMock(...a),
    resolveSettingsProviderId: () => 'claude',
  },
}));

jest.mock('@/features/chat/tabs/tabShared', () => ({
  resolveBlankTabModel: () => 'claude-sonnet-4-5',
}));

jest.mock('@/features/chat/tabs/providerResolution', () => ({
  getTabProviderId: () => 'claude',
}));

jest.mock('@/core/types/settings', () => ({
  asSettingsBag: (s: unknown) => s,
}));

import { launchQuickAction } from '@/features/quickActions/launchQuickAction';
import type { QuickAction } from '@/features/quickActions/types';

const ACTION: QuickAction = {
  id: 'a', name: 'Summarize', description: 'd', prompt: 'Summarize this.',
  filePath: 'qa/summarize.md',
};

function makeFile(): TFile {
  const f = Object.create(TFile.prototype);
  f.path = 'note.md';
  return f as TFile;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

it('end-to-end: launch modal → confirm Codex → tab created with codex + pinned model → prompt dispatched + pill attached', async () => {
  const createdTab = {
    id: 'new-tab',
    lifecycleState: 'blank',
    ui: { fileContextManager: { attachFileAsPill: jest.fn(), attachFolderAsPill: jest.fn() } },
    controllers: { inputController: { sendMessage: jest.fn().mockResolvedValue(undefined) } },
  };
  const tabManager = {
    getActiveTab: () => null,
    canCreateTab: () => true,
    createTab: jest.fn().mockResolvedValue(createdTab),
    switchToTab: jest.fn().mockResolvedValue(undefined),
  };
  const view = { getTabManager: () => tabManager };
  const store = {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    delete: jest.fn(),
  };
  const eventsEmit = jest.fn();
  const plugin = {
    app: {},
    settings: { provider: 'claude' },
    quickActionLastUsedStore: store,
    events: { emit: eventsEmit },
    getView: () => view,
    activateView: jest.fn(),
  } as never;

  await launchQuickAction(plugin, makeFile(), ACTION);

  // Modal mounts under document.body — find provider+model selects + Run button.
  const providerSelect = document.body.querySelector<HTMLSelectElement>('[data-testid="qa-provider"]')!;
  expect(providerSelect).not.toBeNull();
  expect(providerSelect.value).toBe('claude');

  // Switch to Codex
  providerSelect.value = 'codex';
  providerSelect.dispatchEvent(new Event('change'));

  const modelSelect = document.body.querySelector<HTMLSelectElement>('[data-testid="qa-model"]')!;
  expect(modelSelect.value).toBe('gpt-5-codex');

  // Click Run
  const runBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="qa-run"]')!;
  runBtn.click();

  // Drain microtasks so the async onConfirm → set → runQuickActionForFile chain completes.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  expect(store.set).toHaveBeenCalledWith('summarize', {
    providerId: 'codex',
    model: 'gpt-5-codex',
  });
  expect(tabManager.createTab).toHaveBeenCalledWith(
    null,
    undefined,
    expect.objectContaining({
      activate: false,
      defaultProviderId: 'codex',
      pinnedModel: 'gpt-5-codex',
    }),
  );
  expect(tabManager.switchToTab).toHaveBeenCalledWith('new-tab');
  expect(createdTab.ui.fileContextManager.attachFileAsPill).toHaveBeenCalledWith('note.md');
  expect(createdTab.controllers.inputController.sendMessage)
    .toHaveBeenCalledWith({ content: 'Summarize this.' });
  expect(eventsEmit).toHaveBeenCalledWith('usage.recorded', expect.objectContaining({
    kind: 'quickAction',
    name: 'summarize',
  }));
});

it('integration: Cancel path does not persist or dispatch', async () => {
  const tabManager = {
    getActiveTab: () => null,
    canCreateTab: () => true,
    createTab: jest.fn(),
    switchToTab: jest.fn(),
  };
  const view = { getTabManager: () => tabManager };
  const store = { get: jest.fn().mockReturnValue(null), set: jest.fn(), delete: jest.fn() };
  const plugin = {
    app: {},
    settings: { provider: 'claude' },
    quickActionLastUsedStore: store,
    events: { emit: jest.fn() },
    getView: () => view,
    activateView: jest.fn(),
  } as never;

  await launchQuickAction(plugin, makeFile(), ACTION);
  const cancelBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="qa-cancel"]')!;
  expect(cancelBtn).not.toBeNull();
  cancelBtn.click();
  await new Promise((r) => setTimeout(r, 0));

  expect(store.set).not.toHaveBeenCalled();
  expect(tabManager.createTab).not.toHaveBeenCalled();
});

// Fallback-notice integration: the i18n field set was renamed mid-flight
// (storedProviderId → storedProviderLabel, storedModel → storedModelLabel)
// and the unit-level QuickActionLaunchModal test already pins the DOM
// contract end-to-end. An integration variant here would be pure
// duplication, so it is intentionally omitted.
