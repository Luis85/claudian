import {
  detectRiskyProjectSettings,
  isVaultTrusted,
  setVaultTrusted,
  shouldHonorProjectSettings,
  shouldHonorProjectSettingsForRisk,
} from '@/core/security/vaultTrust';

describe('detectRiskyProjectSettings (SEC-2)', () => {
  it('returns false for null/empty settings', () => {
    expect(detectRiskyProjectSettings(null)).toBe(false);
    expect(detectRiskyProjectSettings(undefined)).toBe(false);
    expect(detectRiskyProjectSettings({})).toBe(false);
  });

  it('flags any non-empty hooks definition', () => {
    expect(detectRiskyProjectSettings({ hooks: { SessionStart: [{ command: 'x' }] } })).toBe(true);
    expect(detectRiskyProjectSettings({ hooks: [{ command: 'x' }] })).toBe(true);
  });

  it('does not flag empty hooks containers', () => {
    expect(detectRiskyProjectSettings({ hooks: {} })).toBe(false);
    expect(detectRiskyProjectSettings({ hooks: [] })).toBe(false);
  });

  it('flags a non-empty permissions.allow list', () => {
    expect(detectRiskyProjectSettings({ permissions: { allow: ['Bash(*)'] } })).toBe(true);
  });

  it('does not flag an empty or missing allow list', () => {
    expect(detectRiskyProjectSettings({ permissions: { allow: [] } })).toBe(false);
    expect(detectRiskyProjectSettings({ permissions: {} })).toBe(false);
  });

  it('flags a privilege-widening defaultMode (acceptEdits / bypassPermissions)', () => {
    expect(detectRiskyProjectSettings({ permissions: { defaultMode: 'acceptEdits' } })).toBe(true);
    expect(detectRiskyProjectSettings({ permissions: { defaultMode: 'bypassPermissions' } })).toBe(true);
  });

  it('does not flag a safe or restrictive defaultMode (default / plan)', () => {
    expect(detectRiskyProjectSettings({ permissions: { defaultMode: 'default' } })).toBe(false);
    expect(detectRiskyProjectSettings({ permissions: { defaultMode: 'plan' } })).toBe(false);
  });

  it('flags non-empty additionalDirectories but not deny-only', () => {
    expect(detectRiskyProjectSettings({ permissions: { additionalDirectories: ['/etc'] } })).toBe(true);
    expect(detectRiskyProjectSettings({ permissions: { additionalDirectories: [] } })).toBe(false);
    expect(detectRiskyProjectSettings({ permissions: { deny: ['Bash(*)'] } })).toBe(false);
  });
});

describe('vault trust persistence (SEC-2)', () => {
  it('reports untrusted by default', () => {
    expect(isVaultTrusted({}, 'vault-a')).toBe(false);
  });

  it('round-trips a trust decision', () => {
    const settings: Record<string, unknown> = {};
    setVaultTrusted(settings, 'vault-a', true);
    expect(isVaultTrusted(settings, 'vault-a')).toBe(true);
    expect(isVaultTrusted(settings, 'vault-b')).toBe(false);
  });

  it('clears a trust decision', () => {
    const settings: Record<string, unknown> = {};
    setVaultTrusted(settings, 'vault-a', true);
    setVaultTrusted(settings, 'vault-a', false);
    expect(isVaultTrusted(settings, 'vault-a')).toBe(false);
  });

  it('ignores an empty vault key', () => {
    const settings: Record<string, unknown> = {};
    setVaultTrusted(settings, '', true);
    expect(settings.trustedVaults).toBeUndefined();
    expect(isVaultTrusted(settings, '')).toBe(false);
  });
});

describe('shouldHonorProjectSettings (SEC-2)', () => {
  it('honors non-risky settings regardless of trust', () => {
    expect(shouldHonorProjectSettings({}, 'vault-a', { permissions: { allow: [] } })).toBe(true);
  });

  it('withholds risky settings for an untrusted vault', () => {
    const risky = { hooks: { SessionStart: [{ command: 'x' }] } };
    expect(shouldHonorProjectSettings({}, 'vault-a', risky)).toBe(false);
  });

  it('honors risky settings once the vault is trusted', () => {
    const settings: Record<string, unknown> = {};
    setVaultTrusted(settings, 'vault-a', true);
    const risky = { permissions: { allow: ['Bash(*)'] } };
    expect(shouldHonorProjectSettings(settings, 'vault-a', risky)).toBe(true);
  });
});

describe('shouldHonorProjectSettingsForRisk (SEC-2)', () => {
  it('honors when risk is not flagged regardless of trust', () => {
    expect(shouldHonorProjectSettingsForRisk({}, 'vault-a', false)).toBe(true);
  });

  it('withholds when risky and untrusted', () => {
    expect(shouldHonorProjectSettingsForRisk({}, 'vault-a', true)).toBe(false);
  });

  it('honors when risky and trusted', () => {
    const settings: Record<string, unknown> = {};
    setVaultTrusted(settings, 'vault-a', true);
    expect(shouldHonorProjectSettingsForRisk(settings, 'vault-a', true)).toBe(true);
  });

  it('re-evaluates live trust without re-detecting risk', () => {
    const settings: Record<string, unknown> = {};
    expect(shouldHonorProjectSettingsForRisk(settings, 'vault-a', true)).toBe(false);
    setVaultTrusted(settings, 'vault-a', true);
    expect(shouldHonorProjectSettingsForRisk(settings, 'vault-a', true)).toBe(true);
  });
});
