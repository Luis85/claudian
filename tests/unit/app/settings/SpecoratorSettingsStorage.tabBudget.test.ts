import { SpecoratorSettingsStorage } from '@/app/settings/SpecoratorSettingsStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

const mockAdapter = {
  exists: jest.fn(),
  read: jest.fn(),
  write: jest.fn(),
  delete: jest.fn(),
} as unknown as jest.Mocked<VaultFileAdapter>;

describe('SpecoratorSettingsStorage.load tab-budget migration', () => {
  let storage: SpecoratorSettingsStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.write.mockResolvedValue(undefined);
    storage = new SpecoratorSettingsStorage(mockAdapter);
  });

  it('upgrades legacy { maxTabs: 7 } to maxChatTabs: 7 on first load', async () => {
    // Regression: the storage layer must migrate the RAW stored shape before
    // the defaults merge — otherwise the defaults inject maxChatTabs: 3 and
    // the migration helper sees it as "already set" and drops the user's 7.
    mockAdapter.read.mockResolvedValue(JSON.stringify({ maxTabs: 7 }));

    const result = await storage.load();

    expect(result.maxChatTabs).toBe(7);
    expect('maxTabs' in result).toBe(false);
    expect('maxWorkOrderTabs' in result).toBe(false);
  });

  it('drops legacy maxWorkOrderTabs (collapsed into agentBoardQueueCap)', async () => {
    mockAdapter.read.mockResolvedValue(
      JSON.stringify({ maxChatTabs: 5, maxWorkOrderTabs: 4 }),
    );

    const result = await storage.load();

    expect(result.maxChatTabs).toBe(5);
    expect('maxWorkOrderTabs' in result).toBe(false);
  });

  it('uses defaults when neither legacy nor new keys are present', async () => {
    mockAdapter.read.mockResolvedValue('{}');

    const result = await storage.load();

    expect(result.maxChatTabs).toBe(3);
  });
});
