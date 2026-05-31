/**
 * SECURITY (SEC-2): Per-vault trust gate building blocks.
 *
 * A vault-committed `.claude/settings.json` can carry `hooks` and
 * `permissions.allow` rules, and a vault `.claude/mcp.json` can declare MCP
 * servers. Because the chat runtime runs with the vault as cwd and includes the
 * `project`/`local` setting sources, opening an *untrusted* vault would otherwise
 * auto-honor those — a malicious `SessionStart` hook could run code on turn one.
 *
 * This module is provider-neutral and stateless about UI: it detects whether
 * project settings are "risky", and reads/writes a per-vault trust flag persisted
 * in the app settings. The provider runtime is responsible for (a) consulting
 * `shouldHonorProjectSettings()` before adding project/local setting sources, and
 * (b) surfacing a one-time confirmation modal that calls `setVaultTrusted()`.
 *
 * TODO(SEC-2): Wire `shouldHonorProjectSettings()` into the Claude setting-source
 * resolution (ClaudeQueryOptionsBuilder + claudeColdStartQuery + probeRuntimeCommands)
 * and add the confirmation modal (shared/modals + i18n) that flips the trust flag
 * on first encounter. Detection, persistence, and gating logic land here first so
 * the modal can be added without re-deriving the trust contract.
 */

/** Minimal shape of project `.claude/settings.json` needed for risk detection. */
export interface ProjectSettingsLike {
  hooks?: unknown;
  permissions?: {
    allow?: unknown;
  } | undefined;
  [key: string]: unknown;
}

/**
 * True when the project settings carry capabilities that can execute code or
 * silently widen tool permissions on the first turn: any `hooks` definition, or a
 * non-empty `permissions.allow` list.
 */
export function detectRiskyProjectSettings(settings: ProjectSettingsLike | null | undefined): boolean {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  if (hasNonEmptyHooks(settings.hooks)) {
    return true;
  }

  const allow = settings.permissions?.allow;
  return Array.isArray(allow) && allow.length > 0;
}

function hasNonEmptyHooks(hooks: unknown): boolean {
  if (!hooks || typeof hooks !== 'object') {
    return false;
  }
  if (Array.isArray(hooks)) {
    return hooks.length > 0;
  }
  return Object.keys(hooks as Record<string, unknown>).length > 0;
}

const TRUSTED_VAULTS_KEY = 'trustedVaults';

function getTrustedVaultsMap(settings: Record<string, unknown>): Record<string, boolean> {
  const existing = settings[TRUSTED_VAULTS_KEY];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, boolean>;
  }
  return {};
}

/** Whether the user has explicitly trusted this vault's project settings. */
export function isVaultTrusted(
  settings: Record<string, unknown>,
  vaultKey: string,
): boolean {
  if (!vaultKey) {
    return false;
  }
  return getTrustedVaultsMap(settings)[vaultKey] === true;
}

/** Persist (in-memory) the trust decision for a vault. Caller saves settings. */
export function setVaultTrusted(
  settings: Record<string, unknown>,
  vaultKey: string,
  trusted: boolean,
): void {
  if (!vaultKey) {
    return;
  }
  const map = { ...getTrustedVaultsMap(settings) };
  if (trusted) {
    map[vaultKey] = true;
  } else {
    delete map[vaultKey];
  }
  settings[TRUSTED_VAULTS_KEY] = map;
}

/**
 * Decide whether project/local setting sources (hooks, allow-rules) should be
 * honored for a vault. Risky settings in an untrusted vault are withheld; trusted
 * vaults — and vaults with no risky settings — are honored as before.
 */
export function shouldHonorProjectSettings(
  settings: Record<string, unknown>,
  vaultKey: string,
  projectSettings: ProjectSettingsLike | null | undefined,
): boolean {
  if (!detectRiskyProjectSettings(projectSettings)) {
    return true;
  }
  return isVaultTrusted(settings, vaultKey);
}
