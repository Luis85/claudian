import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { buildProviderRecords } from '@/features/quickActions/skills/buildProviderRecords';

jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getRegisteredProviderIds: jest.fn(),
    getProviderDisplayName: jest.fn(),
    isEnabled: jest.fn(),
  },
}));

jest.mock('@/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: {
    getCommandCatalog: jest.fn(),
  },
}));

jest.mock('@/core/types/settings', () => ({
  asSettingsBag: (s: unknown) => s as Record<string, unknown>,
}));

function makePlugin() {
  return { settings: { dummy: true } } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildProviderRecords', () => {
  it('returns a record per provider that exposes a command catalog', () => {
    (ProviderRegistry.getRegisteredProviderIds as jest.Mock).mockReturnValue([
      'claude',
      'codex',
    ]);
    (ProviderRegistry.getProviderDisplayName as jest.Mock).mockImplementation(
      (id: string) => (id === 'claude' ? 'Claude' : 'Codex'),
    );
    (ProviderRegistry.isEnabled as jest.Mock).mockImplementation(
      (id: string) => id === 'claude',
    );
    (ProviderWorkspaceRegistry.getCommandCatalog as jest.Mock).mockImplementation(
      (id: string) => ({ tag: id }),
    );

    const records = buildProviderRecords(makePlugin());
    expect(records).toEqual([
      {
        providerId: 'claude',
        displayName: 'Claude',
        isEnabled: true,
        commandCatalog: { tag: 'claude' },
      },
      {
        providerId: 'codex',
        displayName: 'Codex',
        isEnabled: false,
        commandCatalog: { tag: 'codex' },
      },
    ]);
  });

  it('drops providers without a command catalog', () => {
    (ProviderRegistry.getRegisteredProviderIds as jest.Mock).mockReturnValue([
      'claude',
      'opencode',
    ]);
    (ProviderRegistry.getProviderDisplayName as jest.Mock).mockReturnValue('X');
    (ProviderRegistry.isEnabled as jest.Mock).mockReturnValue(true);
    (ProviderWorkspaceRegistry.getCommandCatalog as jest.Mock).mockImplementation(
      (id: string) => (id === 'claude' ? { tag: 'claude' } : null),
    );

    const records = buildProviderRecords(makePlugin());
    expect(records.map((r) => r.providerId)).toEqual(['claude']);
  });

  it('reflects per-provider enabled flag from ProviderRegistry.isEnabled', () => {
    (ProviderRegistry.getRegisteredProviderIds as jest.Mock).mockReturnValue(['claude']);
    (ProviderRegistry.getProviderDisplayName as jest.Mock).mockReturnValue('Claude');
    (ProviderRegistry.isEnabled as jest.Mock).mockReturnValue(false);
    (ProviderWorkspaceRegistry.getCommandCatalog as jest.Mock).mockReturnValue({});

    const records = buildProviderRecords(makePlugin());
    expect(records[0].isEnabled).toBe(false);
  });
});
