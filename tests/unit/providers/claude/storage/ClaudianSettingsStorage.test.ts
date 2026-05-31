import '@/providers';

import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import {
  CLAUDIAN_SETTINGS_PATH,
  ClaudianSettingsStorage,
} from '@/providers/claude/storage/ClaudianSettingsStorage';
import { DEFAULT_SETTINGS } from '@/providers/claude/types/settings';


const mockAdapter = {
  exists: jest.fn(),
  read: jest.fn(),
  write: jest.fn(),
  delete: jest.fn(),
} as unknown as jest.Mocked<VaultFileAdapter>;

describe('ClaudianSettingsStorage', () => {
  let storage: ClaudianSettingsStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations to default resolved values
    mockAdapter.exists.mockResolvedValue(false);
    mockAdapter.read.mockResolvedValue('{}');
    mockAdapter.write.mockResolvedValue(undefined);
    mockAdapter.delete.mockResolvedValue(undefined);
    storage = new ClaudianSettingsStorage(mockAdapter);
  });

  describe('load', () => {
    it('should return defaults when file does not exist', async () => {
      mockAdapter.exists.mockResolvedValue(false);

      const result = await storage.load();

      expect(result.model).toBe(DEFAULT_SETTINGS.model);
      expect(result.thinkingBudget).toBe(DEFAULT_SETTINGS.thinkingBudget);
      expect(result.permissionMode).toBe(DEFAULT_SETTINGS.permissionMode);
      expect(result.requireCommandOrControlEnterToSend).toBe(false);
      expect(mockAdapter.read).not.toHaveBeenCalled();
    });

    it('should parse valid JSON and merge with defaults', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        model: 'claude-opus-4-5',
        userName: 'TestUser',
      }));

      const result = await storage.load();

      expect(result.model).toBe('claude-opus-4-5');
      expect(result.userName).toBe('TestUser');
      // Defaults should still be present for unspecified fields
      expect(result.thinkingBudget).toBe(DEFAULT_SETTINGS.thinkingBudget);
    });

    it('should throw on JSON parse error', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue('invalid json');

      await expect(storage.load()).rejects.toThrow();
    });

    it('should throw on read error', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockRejectedValue(new Error('Read failed'));

      await expect(storage.load()).rejects.toThrow('Read failed');
    });
  });

  describe('save', () => {
    it('should write settings to file', async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        model: 'claude-opus-4-5' as const,
      };

      await storage.save(settings);

      expect(mockAdapter.write).toHaveBeenCalledWith(
        CLAUDIAN_SETTINGS_PATH,
        expect.any(String)
      );
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);
      expect(writtenContent.model).toBe('claude-opus-4-5');
      expect(writtenContent.providerConfigs.codex.installationMethodsByHost).toEqual({});
      expect(writtenContent.providerConfigs.codex.wslDistroOverridesByHost).toEqual({});
    });

    it('should throw on write error', async () => {
      mockAdapter.write.mockRejectedValue(new Error('Write failed'));

      await expect(storage.save(DEFAULT_SETTINGS)).rejects.toThrow('Write failed');
    });
  });

  describe('exists', () => {
    it('should return true when the new file exists', async () => {
      mockAdapter.exists.mockImplementation(async (path: string) => (
        path === CLAUDIAN_SETTINGS_PATH
      ));

      const result = await storage.exists();

      expect(result).toBe(true);
      expect(mockAdapter.exists).toHaveBeenCalledWith(CLAUDIAN_SETTINGS_PATH);
    });

    it('should return false when file does not exist', async () => {
      mockAdapter.exists.mockResolvedValue(false);

      const result = await storage.exists();

      expect(result).toBe(false);
    });
  });

  describe('update', () => {
    it('should merge updates with existing settings', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        model: 'claude-haiku-4-5',
        userName: 'ExistingUser',
      }));

      await storage.update({ model: 'claude-opus-4-5' });

      const writeCall = mockAdapter.write.mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1]);
      expect(writtenContent.model).toBe('claude-opus-4-5');
      expect(writtenContent.userName).toBe('ExistingUser');
    });
  });

  describe('setLastModel', () => {
    it('should update lastClaudeModel for non-custom models', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({}));

      await storage.setLastModel('claude-sonnet-4-5', false);

      const writeCall = mockAdapter.write.mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1]);
      expect(writtenContent.providerConfigs.claude.lastModel).toBe('claude-sonnet-4-5');
      // lastCustomModel keeps its default value (empty string)
    });

    it('should update lastCustomModel for custom models', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({}));

      await storage.setLastModel('custom-model-id', true);

      const writeCall = mockAdapter.write.mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1]);
      expect(writtenContent.lastCustomModel).toBe('custom-model-id');
      // lastClaudeModel keeps its default value
    });
  });

  describe('setLastEnvHash', () => {
    it('should update environment hash', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({}));

      await storage.setLastEnvHash('abc123');

      const writeCall = mockAdapter.write.mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1]);
      expect(writtenContent.providerConfigs.claude.environmentHash).toBe('abc123');
    });
  });
});
