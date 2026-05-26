import {
  getProviderEnableUpdater,
  PROVIDER_ENABLE_UPDATERS,
} from '@/features/settings/providerEnableUpdaters';
import { getClaudeProviderSettings } from '@/providers/claude/settings';
import { getCodexProviderSettings } from '@/providers/codex/settings';
import { getCursorProviderSettings } from '@/providers/cursor/settings';
import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

describe('providerEnableUpdaters', () => {
  describe('getProviderEnableUpdater', () => {
    it('returns an updater for every known provider', () => {
      for (const providerId of ['claude', 'cursor', 'codex', 'opencode']) {
        expect(getProviderEnableUpdater(providerId)).toBe(PROVIDER_ENABLE_UPDATERS[providerId]);
      }
    });

    it('returns null for an unknown provider', () => {
      expect(getProviderEnableUpdater('nonexistent')).toBeNull();
    });
  });

  describe('PROVIDER_ENABLE_UPDATERS', () => {
    it('toggles the claude enabled flag', () => {
      const settings: Record<string, unknown> = {};
      PROVIDER_ENABLE_UPDATERS.claude(settings, false);
      expect(getClaudeProviderSettings(settings).enabled).toBe(false);
      PROVIDER_ENABLE_UPDATERS.claude(settings, true);
      expect(getClaudeProviderSettings(settings).enabled).toBe(true);
    });

    it('toggles the cursor enabled flag', () => {
      const settings: Record<string, unknown> = {};
      PROVIDER_ENABLE_UPDATERS.cursor(settings, true);
      expect(getCursorProviderSettings(settings).enabled).toBe(true);
      PROVIDER_ENABLE_UPDATERS.cursor(settings, false);
      expect(getCursorProviderSettings(settings).enabled).toBe(false);
    });

    it('toggles the codex enabled flag', () => {
      const settings: Record<string, unknown> = {};
      PROVIDER_ENABLE_UPDATERS.codex(settings, true);
      expect(getCodexProviderSettings(settings).enabled).toBe(true);
      PROVIDER_ENABLE_UPDATERS.codex(settings, false);
      expect(getCodexProviderSettings(settings).enabled).toBe(false);
    });

    it('toggles the opencode enabled flag', () => {
      const settings: Record<string, unknown> = {};
      PROVIDER_ENABLE_UPDATERS.opencode(settings, true);
      expect(getOpencodeProviderSettings(settings).enabled).toBe(true);
      PROVIDER_ENABLE_UPDATERS.opencode(settings, false);
      expect(getOpencodeProviderSettings(settings).enabled).toBe(false);
    });
  });
});
