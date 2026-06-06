import { TFile } from 'obsidian';

import { launchQuickAction } from '@/features/quickActions/launchQuickAction';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => ({
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

const openModalMock = jest.fn();
jest.mock('@/features/quickActions/ui/QuickActionLaunchModal', () => ({
  QuickActionLaunchModal: jest.fn().mockImplementation((options) => ({
    open: () => openModalMock(options),
  })),
}));

const runMock = jest.fn().mockResolvedValue(undefined);
jest.mock('@/features/quickActions/runQuickActionForFile', () => ({
  runQuickActionForFile: (...args: unknown[]) => runMock(...args),
  quickActionStemFromPath: (p: string) => p.split('/').pop()?.replace(/\.md$/, '') ?? p,
}));

const isEnabledMock = jest.fn();
const getRegisteredMock = jest.fn();
const getChatUIConfigMock = jest.fn();
const getProviderDisplayNameMock = jest.fn();
const resolveSettingsProviderMock = jest.fn();
jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    isEnabled: (...args: unknown[]) => isEnabledMock(...args),
    getRegisteredProviderIds: () => getRegisteredMock(),
    getChatUIConfig: (...args: unknown[]) => getChatUIConfigMock(...args),
    getProviderDisplayName: (...args: unknown[]) => getProviderDisplayNameMock(...args),
    resolveSettingsProviderId: (...args: unknown[]) => resolveSettingsProviderMock(...args),
  },
}));

const resolveBlankTabModelMock = jest.fn();
jest.mock('@/features/chat/tabs/tabShared', () => ({
  resolveBlankTabModel: (...args: unknown[]) => resolveBlankTabModelMock(...args),
}));

jest.mock('@/core/types/settings', () => ({
  asSettingsBag: (s: unknown) => s,
}));

const ACTION: QuickAction = {
  id: 'a', name: 'Summarize', description: 'd', prompt: 'p',
  filePath: 'qa/summarize.md',
};

function makeFile(): TFile {
  const f = Object.create(TFile.prototype);
  f.path = 'note.md';
  return f;
}

function makePlugin(store: { get: jest.Mock; set: jest.Mock; delete: jest.Mock }) {
  return {
    app: {},
    settings: { provider: 'claude' },
    quickActionLastUsedStore: store,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  getRegisteredMock.mockReturnValue(['claude', 'codex']);
  getChatUIConfigMock.mockImplementation((id) => ({
    config: { displayName: id === 'claude' ? 'Claude' : 'Codex' },
    getModelOptions: () => (id === 'claude'
      ? [{ value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' }]
      : [{ value: 'gpt-5-codex', label: 'gpt-5-codex' }]),
  }));
  getProviderDisplayNameMock.mockImplementation((id) => (id === 'claude' ? 'Claude' : 'Codex'));
  isEnabledMock.mockReturnValue(true);
  resolveSettingsProviderMock.mockReturnValue('claude');
  resolveBlankTabModelMock.mockReturnValue('claude-sonnet-4-5');
});

describe('launchQuickAction', () => {
  it('uses stored entry when valid, no fallback notice', async () => {
    const store = {
      get: jest.fn().mockReturnValue({ providerId: 'codex', model: 'gpt-5-codex', updatedAt: 1 }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);

    const opts = openModalMock.mock.calls[0][0];
    expect(opts.presetProviderId).toBe('codex');
    expect(opts.presetModel).toBe('gpt-5-codex');
    expect(opts.fallbackNotice).toBeUndefined();
  });

  it('falls back + passes fallbackNotice when stored provider is disabled', async () => {
    const store = {
      get: jest.fn().mockReturnValue({ providerId: 'codex', model: 'gpt-5-codex', updatedAt: 1 }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    isEnabledMock.mockImplementation((id) => id !== 'codex');
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);

    const opts = openModalMock.mock.calls[0][0];
    expect(opts.presetProviderId).toBe('claude');
    expect(opts.presetModel).toBe('claude-sonnet-4-5');
    expect(opts.fallbackNotice).toEqual({ storedProviderId: 'codex', storedModel: 'gpt-5-codex' });
    expect(store.delete).toHaveBeenCalledWith('summarize');
  });

  it('falls back + passes fallbackNotice when stored model missing', async () => {
    const store = {
      get: jest.fn().mockReturnValue({ providerId: 'claude', model: 'unknown-model', updatedAt: 1 }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);

    const opts = openModalMock.mock.calls[0][0];
    expect(opts.presetModel).toBe('claude-sonnet-4-5');
    expect(opts.fallbackNotice?.storedModel).toBe('unknown-model');
  });

  it('uses global default + no notice on store miss', async () => {
    const store = { get: jest.fn().mockReturnValue(null), set: jest.fn(), delete: jest.fn() };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);

    const opts = openModalMock.mock.calls[0][0];
    expect(opts.presetProviderId).toBe('claude');
    expect(opts.presetModel).toBe('claude-sonnet-4-5');
    expect(opts.fallbackNotice).toBeUndefined();
  });

  it('confirm persists choice and dispatches with override', async () => {
    const store = { get: jest.fn().mockReturnValue(null), set: jest.fn(), delete: jest.fn() };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);
    const opts = openModalMock.mock.calls[0][0];
    opts.onConfirm({ providerId: 'codex', model: 'gpt-5-codex' });
    await new Promise((r) => setImmediate(r));

    expect(store.set).toHaveBeenCalledWith('summarize', { providerId: 'codex', model: 'gpt-5-codex' });
    expect(runMock).toHaveBeenCalledWith(
      plugin,
      expect.any(Object),
      ACTION,
      { providerId: 'codex', model: 'gpt-5-codex' },
    );
  });

  it('cancel (modal closes without onConfirm) does not persist and does not dispatch', async () => {
    const store = { get: jest.fn().mockReturnValue(null), set: jest.fn(), delete: jest.fn() };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);
    expect(store.set).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });
});
