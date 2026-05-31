import {
  detectRiskyProjectSettings,
  isVaultTrusted,
  setVaultTrusted,
  shouldHonorProjectSettingsForRisk,
} from '../../../core/security/vaultTrust';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { asSettingsBag } from '../../../core/types';
import type { PluginContext } from '../../../core/types/PluginContext';
import { getVaultPath } from '../../../utils/path';
import { CC_SETTINGS_PATH } from '../storage/CCSettingsStorage';

/**
 * SECURITY (SEC-2): per-vault trust gate for risky project `.claude/settings.json`.
 *
 * The Claude query paths use the vault as cwd and include the `project`/`local`
 * setting sources, so a vault-committed `hooks` block (arbitrary shell on turn
 * start) or `permissions.allow` (auto-approve dangerous tools) would otherwise be
 * honored with no consent. This module detects that risk once (an async read of
 * `.claude/settings.json` at workspace init), caches the boolean, and exposes a
 * synchronous honor-decision so per-turn source resolution stays cheap while still
 * re-evaluating trust against the live `trustedVaults` map.
 *
 * The vault key is the vault path (opaque, per-vault) — the same identity the
 * `trustedVaults` map keys on.
 */

/** Cached risk flag for the active vault. Detected once at workspace init. */
let cachedRiskyProjectSettings = false;

/** Vault path whose risk flag is currently cached, to guard stale reads. */
let cachedVaultKey = '';

/** The opaque per-vault trust key: the vault's absolute path. */
export function getVaultTrustKey(plugin: PluginContext): string {
  return getVaultPath(plugin.app) ?? '';
}

/**
 * Read the vault's `.claude/settings.json` and cache whether it carries risky
 * settings (hooks / non-empty permissions.allow). Best-effort: a missing or
 * unparsable file is treated as non-risky. Run once at Claude workspace init.
 */
export async function detectVaultProjectRisk(
  plugin: PluginContext,
  adapter: VaultFileAdapter,
): Promise<boolean> {
  cachedVaultKey = getVaultTrustKey(plugin);
  cachedRiskyProjectSettings = false;
  try {
    if (await adapter.exists(CC_SETTINGS_PATH)) {
      const raw = await adapter.read(CC_SETTINGS_PATH);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      cachedRiskyProjectSettings = detectRiskyProjectSettings(parsed);
    }
  } catch {
    // Unreadable/unparsable project settings cannot be honored anyway; the SDK
    // would also reject them. Treat as non-risky so a corrupt file never blocks.
    cachedRiskyProjectSettings = false;
  }
  return cachedRiskyProjectSettings;
}

/** Whether the cached project settings for `vaultKey` were flagged risky. */
export function vaultProjectSettingsRiskyForKey(vaultKey: string): boolean {
  // Guard against a vault switch the cache hasn't caught up with: an unknown
  // vault is treated as not-yet-detected (non-risky) rather than reusing a stale
  // risk flag from a different vault.
  return !!vaultKey && cachedVaultKey === vaultKey && cachedRiskyProjectSettings;
}

/** Whether the active vault's cached project settings were flagged risky. */
export function vaultProjectSettingsRisky(plugin: PluginContext): boolean {
  return vaultProjectSettingsRiskyForKey(getVaultTrustKey(plugin));
}

/**
 * Synchronous decision keyed directly on a settings bag + vault path, for the
 * query-options builder which carries `settings`/`vaultPath` but not `plugin`.
 * Honors `project`/`local` only for non-risky or trusted vaults.
 */
export function shouldHonorClaudeProjectSettingsFor(
  settings: Record<string, unknown>,
  vaultKey: string,
): boolean {
  return shouldHonorProjectSettingsForRisk(
    settings,
    vaultKey,
    vaultProjectSettingsRiskyForKey(vaultKey),
  );
}

/**
 * Synchronous decision for the live query paths: honor `project`/`local` setting
 * sources only when the vault has no risky project settings, or has been trusted.
 */
export function shouldHonorClaudeProjectSettings(plugin: PluginContext): boolean {
  return shouldHonorClaudeProjectSettingsFor(
    asSettingsBag(plugin.settings),
    getVaultTrustKey(plugin),
  );
}

/** Whether the active vault has been explicitly trusted. */
export function isClaudeVaultTrusted(plugin: PluginContext): boolean {
  return isVaultTrusted(asSettingsBag(plugin.settings), getVaultTrustKey(plugin));
}

/** Persist a trust decision for the active vault. */
export async function setClaudeVaultTrusted(
  plugin: PluginContext,
  trusted: boolean,
): Promise<void> {
  setVaultTrusted(asSettingsBag(plugin.settings), getVaultTrustKey(plugin), trusted);
  await plugin.saveSettings();
}

/** Test-only: reset the module-level cache between cases. */
export function __resetVaultProjectRiskCacheForTests(): void {
  cachedRiskyProjectSettings = false;
  cachedVaultKey = '';
}
