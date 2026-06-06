import { TFile } from 'obsidian';

import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
import type { SkillTabEntry } from '@/features/quickActions/skills/types';
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

jest.mock('@/features/quickActions/skills/buildProviderRecords', () => ({
  buildProviderRecords: jest.fn().mockReturnValue([]),
}));

jest.mock('@/features/quickActions/skills/VaultSkillAggregator', () => ({
  VaultSkillAggregator: jest.fn().mockImplementation(() => ({
    listAll: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('@/features/quickActions/skills/runVaultSkill', () => ({
  runVaultSkill: jest.fn().mockResolvedValue(undefined),
}));

const launchMock = jest.fn();
jest.mock('@/features/quickActions/launchQuickAction', () => ({
  launchQuickAction: (...args: unknown[]) => launchMock(...args),
}));

// Capture the onRun/onRunSkill callbacks + aggregator passed to QuickActionsModal.
let capturedOnRun: ((action: QuickAction) => void) | null = null;
let capturedOnRunSkill: ((entry: SkillTabEntry) => void) | null = null;
let capturedAggregator: unknown = null;

jest.mock('@/features/quickActions/ui/QuickActionsModal', () => ({
  QuickActionsModal: jest.fn().mockImplementation((_app: unknown, callbacks: {
    onRun: (action: QuickAction) => void;
    onRunSkill: (entry: SkillTabEntry) => void;
    aggregator: unknown;
  }) => {
    capturedOnRun = callbacks.onRun;
    capturedOnRunSkill = callbacks.onRunSkill;
    capturedAggregator = callbacks.aggregator;
    return { open: jest.fn() };
  }),
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

// ---- Helpers ---------------------------------------------------------------

const MOCK_ACTION: QuickAction = {
  id: 'act-1',
  name: 'Summarize',
  description: 'Summarize the note',
  prompt: 'Summarize this.',
  filePath: 'Quick Actions/summarize.md',
};

function makeMockPlugin() {
  return {
    app: { vault: {} },
    settings: { quickActionsFolder: 'Quick Actions' },
    storage: { getAdapter: jest.fn(() => ({})) },
    logger: undefined,
    events: { emit: jest.fn() },
    getView: jest.fn(() => null),
    activateView: jest.fn().mockResolvedValue(undefined),
  };
}

// ---- Tests -----------------------------------------------------------------

beforeEach(() => {
  capturedOnRun = null;
  capturedOnRunSkill = null;
  capturedAggregator = null;
  jest.clearAllMocks();
});

describe('openContextMenuQuickAction', () => {
  it('opens QuickActionsModal', () => {
    const plugin = makeMockPlugin();

    openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);

    const { QuickActionsModal } = jest.requireMock('@/features/quickActions/ui/QuickActionsModal');
    expect(QuickActionsModal).toHaveBeenCalledTimes(1);
  });

  it('onRun delegates to launchQuickAction with (plugin, file, action)', () => {
    const plugin = makeMockPlugin();
    const file = { path: 'note.md' } as TFile;

    openContextMenuQuickAction(plugin as any, file);
    capturedOnRun!(MOCK_ACTION);

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock).toHaveBeenCalledWith(plugin, file, MOCK_ACTION);
  });

  describe('skills wiring', () => {
    it('passes a VaultSkillAggregator into the modal', () => {
      const plugin = makeMockPlugin();
      openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
      expect(capturedAggregator).not.toBeNull();
    });

    it('routes onRunSkill to runVaultSkill with the same file argument', () => {
      const { runVaultSkill } = jest.requireMock(
        '@/features/quickActions/skills/runVaultSkill',
      );
      const plugin = makeMockPlugin();
      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      openContextMenuQuickAction(plugin as any, file);
      const entry = {
        id: 'claude:skill-x',
        name: 'x',
        providerId: 'claude',
        providerDisplayName: 'Claude',
        description: '',
        insertPrefix: '/',
        sourceFilePath: null,
        providerEnabled: true,
      } as SkillTabEntry;
      capturedOnRunSkill!(entry);
      expect(runVaultSkill).toHaveBeenCalledWith(plugin, entry, file);
    });
  });
});
