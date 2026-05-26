import {
  getCursorEnabledModels,
  getCursorProviderSettings,
  normalizeEnabledModelsByHost,
  setCursorEnabledModels,
} from '@/providers/cursor/settings';

const mockGetHostnameKey = jest.fn(() => 'host-a');

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
}));

describe('cursor settings — curated models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHostnameKey.mockReturnValue('host-a');
  });

  describe('normalizeEnabledModelsByHost', () => {
    it('returns an empty object for junk input', () => {
      expect(normalizeEnabledModelsByHost(null)).toEqual({});
      expect(normalizeEnabledModelsByHost(undefined)).toEqual({});
      expect(normalizeEnabledModelsByHost('nope')).toEqual({});
      expect(normalizeEnabledModelsByHost(['a', 'b'])).toEqual({});
      expect(normalizeEnabledModelsByHost(42)).toEqual({});
    });

    it('coerces values to trimmed, non-empty, de-duplicated string arrays', () => {
      const result = normalizeEnabledModelsByHost({
        'host-a': ['  gpt-5.5  ', 'composer-2', '', '  ', 'composer-2', 7, null],
        'host-b': 'not-an-array',
        '   ': ['x'],
      });
      expect(result).toEqual({
        'host-a': ['gpt-5.5', 'composer-2'],
      });
    });

    it('keeps a host with an empty (but valid) array', () => {
      expect(normalizeEnabledModelsByHost({ 'host-a': [] })).toEqual({ 'host-a': [] });
    });
  });

  describe('getCursorEnabledModels / setCursorEnabledModels round-trip', () => {
    it('returns [] when nothing is curated for the current host', () => {
      expect(getCursorEnabledModels({})).toEqual([]);
    });

    it('writes and reads back the curated ids for the current host', () => {
      const bag: Record<string, unknown> = {};
      setCursorEnabledModels(bag, ['gpt-5.5', 'composer-2']);
      expect(getCursorEnabledModels(bag)).toEqual(['gpt-5.5', 'composer-2']);
    });

    it('trims and de-duplicates on write', () => {
      const bag: Record<string, unknown> = {};
      setCursorEnabledModels(bag, ['  gpt-5.5 ', 'gpt-5.5', '', 'composer-2']);
      expect(getCursorEnabledModels(bag)).toEqual(['gpt-5.5', 'composer-2']);
    });

    it('clears the host entry when an empty list is written', () => {
      const bag: Record<string, unknown> = {};
      setCursorEnabledModels(bag, ['gpt-5.5']);
      setCursorEnabledModels(bag, []);
      expect(getCursorEnabledModels(bag)).toEqual([]);
      expect(getCursorProviderSettings(bag).enabledModelsByHost).toEqual({});
    });

    it('is per-machine: another host keeps its own curated list', () => {
      const bag: Record<string, unknown> = {};
      mockGetHostnameKey.mockReturnValue('host-a');
      setCursorEnabledModels(bag, ['gpt-5.5']);

      mockGetHostnameKey.mockReturnValue('host-b');
      setCursorEnabledModels(bag, ['composer-2']);
      expect(getCursorEnabledModels(bag)).toEqual(['composer-2']);

      mockGetHostnameKey.mockReturnValue('host-a');
      expect(getCursorEnabledModels(bag)).toEqual(['gpt-5.5']);

      expect(getCursorProviderSettings(bag).enabledModelsByHost).toEqual({
        'host-a': ['gpt-5.5'],
        'host-b': ['composer-2'],
      });
    });
  });

  describe('getCursorProviderSettings', () => {
    it('defaults enabledModelsByHost to {}', () => {
      expect(getCursorProviderSettings({}).enabledModelsByHost).toEqual({});
    });

    it('normalizes persisted junk on read', () => {
      const settings = getCursorProviderSettings({
        providerConfigs: {
          cursor: {
            enabledModelsByHost: {
              'host-a': ['gpt-5.5', '', 123, 'gpt-5.5'],
            },
          },
        },
      });
      expect(settings.enabledModelsByHost).toEqual({ 'host-a': ['gpt-5.5'] });
    });
  });
});
