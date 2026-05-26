import {
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  getClaudeProviderSettings,
  updateClaudeProviderSettings,
} from '@/providers/claude/settings';

describe('Claude provider enabled flag', () => {
  it('defaults to disabled when settings are absent (providers are opt-in)', () => {
    expect(DEFAULT_CLAUDE_PROVIDER_SETTINGS.enabled).toBe(false);
    expect(getClaudeProviderSettings({}).enabled).toBe(false);
  });

  it('treats a missing enabled field as disabled (opt-in default)', () => {
    const settings = {
      providerConfigs: {
        claude: { safeMode: 'auto' },
      },
    };
    expect(getClaudeProviderSettings(settings).enabled).toBe(false);
  });

  it('respects an explicit true', () => {
    const settings = {
      providerConfigs: {
        claude: { enabled: true },
      },
    };
    expect(getClaudeProviderSettings(settings).enabled).toBe(true);
  });

  it('respects an explicit false', () => {
    const settings = {
      providerConfigs: {
        claude: { enabled: false },
      },
    };
    expect(getClaudeProviderSettings(settings).enabled).toBe(false);
  });

  it('persists the enabled flag through the update writer', () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: false });
    expect(getClaudeProviderSettings(settings).enabled).toBe(false);

    updateClaudeProviderSettings(settings, { enabled: true });
    expect(getClaudeProviderSettings(settings).enabled).toBe(true);
  });
});
