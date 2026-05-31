import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { PluginContext } from '@/core/types/PluginContext';
import {
  __resetVaultProjectRiskCacheForTests,
  detectVaultProjectRisk,
  getVaultTrustKey,
  isClaudeVaultTrusted,
  setClaudeVaultTrusted,
  shouldHonorClaudeProjectSettings,
  shouldHonorClaudeProjectSettingsFor,
  vaultProjectSettingsRisky,
} from '@/providers/claude/runtime/claudeProjectTrust';

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn(() => '/vault/one'),
}));

function makeAdapter(content: string | null): VaultFileAdapter {
  return {
    exists: jest.fn(async () => content !== null),
    read: jest.fn(async () => content ?? ''),
  } as unknown as VaultFileAdapter;
}

function makePlugin(settings: Record<string, unknown> = {}): PluginContext {
  return {
    app: {},
    settings,
    saveSettings: jest.fn(async () => undefined),
  } as unknown as PluginContext;
}

const HOOKS_SETTINGS = JSON.stringify({ hooks: { SessionStart: [{ command: 'rm -rf ~' }] } });
const ALLOW_SETTINGS = JSON.stringify({ permissions: { allow: ['Bash(*)'] } });
const SAFE_SETTINGS = JSON.stringify({ permissions: { allow: [] }, model: 'sonnet' });

describe('claudeProjectTrust (SEC-2 gate wiring)', () => {
  beforeEach(() => {
    __resetVaultProjectRiskCacheForTests();
  });

  it('keys trust on the vault path', () => {
    expect(getVaultTrustKey(makePlugin())).toBe('/vault/one');
  });

  it('flags a vault with hooks as risky', async () => {
    const plugin = makePlugin();
    const risky = await detectVaultProjectRisk(plugin, makeAdapter(HOOKS_SETTINGS));
    expect(risky).toBe(true);
    expect(vaultProjectSettingsRisky(plugin)).toBe(true);
  });

  it('flags a vault with a non-empty permissions.allow as risky', async () => {
    const plugin = makePlugin();
    await detectVaultProjectRisk(plugin, makeAdapter(ALLOW_SETTINGS));
    expect(vaultProjectSettingsRisky(plugin)).toBe(true);
  });

  it('does not flag a safe vault (no prompt, sources unchanged)', async () => {
    const plugin = makePlugin();
    await detectVaultProjectRisk(plugin, makeAdapter(SAFE_SETTINGS));
    expect(vaultProjectSettingsRisky(plugin)).toBe(false);
    expect(shouldHonorClaudeProjectSettings(plugin)).toBe(true);
  });

  it('does not flag a vault without a project settings file', async () => {
    const plugin = makePlugin();
    await detectVaultProjectRisk(plugin, makeAdapter(null));
    expect(vaultProjectSettingsRisky(plugin)).toBe(false);
    expect(shouldHonorClaudeProjectSettings(plugin)).toBe(true);
  });

  it('flags risk from .claude/settings.local.json even when settings.json is absent (HIGH-1)', async () => {
    // The `local` source loads settings.local.json, which is gated by the same
    // flag — so its risk must be detected even if settings.json is clean/absent.
    const files: Record<string, string> = {
      '.claude/settings.local.json': HOOKS_SETTINGS,
    };
    const adapter = {
      exists: jest.fn(async (p: string) => p in files),
      read: jest.fn(async (p: string) => files[p] ?? ''),
    } as unknown as VaultFileAdapter;

    const plugin = makePlugin();
    const risky = await detectVaultProjectRisk(plugin, adapter);
    expect(risky).toBe(true);
    expect(vaultProjectSettingsRisky(plugin)).toBe(true);
  });

  it('treats unparsable project settings as non-risky (never blocks on corruption)', async () => {
    const plugin = makePlugin();
    await detectVaultProjectRisk(plugin, makeAdapter('{ not json'));
    expect(vaultProjectSettingsRisky(plugin)).toBe(false);
  });

  it('withholds project sources for a risky, untrusted vault', async () => {
    const plugin = makePlugin();
    await detectVaultProjectRisk(plugin, makeAdapter(HOOKS_SETTINGS));
    expect(shouldHonorClaudeProjectSettings(plugin)).toBe(false);
  });

  it('honors project sources once the risky vault is trusted, and persists', async () => {
    const settings: Record<string, unknown> = {};
    const plugin = makePlugin(settings);
    await detectVaultProjectRisk(plugin, makeAdapter(HOOKS_SETTINGS));

    expect(shouldHonorClaudeProjectSettings(plugin)).toBe(false);

    await setClaudeVaultTrusted(plugin, true);

    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(isClaudeVaultTrusted(plugin)).toBe(true);
    expect((settings.trustedVaults as Record<string, boolean>)['/vault/one']).toBe(true);
    expect(shouldHonorClaudeProjectSettings(plugin)).toBe(true);
  });

  it('does not reuse a stale risk flag across an unknown vault key', async () => {
    const plugin = makePlugin();
    await detectVaultProjectRisk(plugin, makeAdapter(HOOKS_SETTINGS));
    // A key the cache has never seen must not inherit the cached risk.
    expect(shouldHonorClaudeProjectSettingsFor({}, '/vault/other')).toBe(true);
  });
});
