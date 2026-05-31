import * as fs from 'fs';
import * as path from 'path';

import {
  detectRiskyProjectSettings,
  isVaultTrusted,
  setVaultTrusted,
  shouldHonorProjectSettingsForRisk,
} from '../../../core/security/vaultTrust';
import { asSettingsBag } from '../../../core/types';
import type { PluginContext } from '../../../core/types/PluginContext';
import { getVaultPath } from '../../../utils/path';
import { CC_SETTINGS_PATH } from '../storage/CCSettingsStorage';

/**
 * The `local` SDK setting source loads `.claude/settings.local.json`, which is
 * exactly as capable (hooks / allow-rules) as `.claude/settings.json` and is
 * enabled by the same gate — so its risk must be detected too (SEC-2).
 */
const CC_LOCAL_SETTINGS_PATH = CC_SETTINGS_PATH.replace(/settings\.json$/, 'settings.local.json');

/**
 * SECURITY (SEC-2): per-vault trust gate for risky project `.claude/settings.json`.
 *
 * The Claude query paths use the vault as cwd and include the `project`/`local`
 * setting sources, so a vault-committed `hooks` block (arbitrary shell on turn
 * start) or `permissions.allow` (auto-approve dangerous tools) would otherwise be
 * honored with no consent. Risk is read FRESH from disk on every honor-decision
 * (the settings files are tiny) rather than cached at init, so a file
 * created/changed after workspace init — e.g. pulled vault updates before the
 * first turn — can never slip past the gate via a stale flag. The decision stays
 * synchronous and re-evaluates trust against the live `trustedVaults` map.
 *
 * The vault key is the vault path (opaque, per-vault) — the same identity the
 * `trustedVaults` map keys on.
 */

/** The opaque per-vault trust key: the vault's absolute path. */
export function getVaultTrustKey(plugin: PluginContext): string {
  return getVaultPath(plugin.app) ?? '';
}

/** Read one settings file from disk and report whether it is risky (fail-safe). */
function readSettingsFileRisk(absPath: string): boolean {
  try {
    if (!fs.existsSync(absPath)) {
      return false;
    }
    const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8')) as Record<string, unknown>;
    return detectRiskyProjectSettings(parsed);
  } catch {
    // Unreadable/unparsable settings cannot be honored anyway; the SDK would also
    // reject them. Treat as non-risky so a corrupt file never blocks.
    return false;
  }
}

/**
 * Whether the vault at `vaultKey` currently carries risky project settings —
 * read fresh from `.claude/settings.json` AND `.claude/settings.local.json`
 * (both feed the gated `project`/`local` SDK sources) on every call.
 */
export function vaultProjectSettingsRiskyForKey(vaultKey: string): boolean {
  if (!vaultKey) {
    return false;
  }
  return readSettingsFileRisk(path.join(vaultKey, CC_SETTINGS_PATH))
    || readSettingsFileRisk(path.join(vaultKey, CC_LOCAL_SETTINGS_PATH));
}

/** Whether the active vault currently carries risky project settings. */
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
