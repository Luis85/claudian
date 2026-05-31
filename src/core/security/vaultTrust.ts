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
 * in the app settings. The Claude provider wires this in via `claudeProjectTrust`,
 * which (a) consults `shouldHonorProjectSettingsForRisk()` before adding the
 * project/local setting sources in every live query path
 * (ClaudeQueryOptionsBuilder, claudeColdStartQuery, probeRuntimeCommands), and
 * (b) surfaces a one-time confirmation modal that calls `setVaultTrusted()`.
 */

/** Minimal shape of project `.claude/settings.json` needed for risk detection. */
export interface ProjectSettingsLike {
  hooks?: unknown;
  permissions?: {
    allow?: unknown;
    deny?: unknown;
    defaultMode?: unknown;
    additionalDirectories?: unknown;
  } | undefined;
  [key: string]: unknown;
}

/** Permission `defaultMode` values that widen auto-approval beyond the default. */
const PRIVILEGE_WIDENING_MODES = new Set(['acceptEdits', 'bypassPermissions']);

/**
 * True when the project settings carry capabilities that can execute code or
 * silently widen tool permissions on the first turn: any `hooks` definition, a
 * non-empty `permissions.allow` list, a privilege-widening `permissions.defaultMode`
 * (acceptEdits / bypassPermissions), or non-empty `permissions.additionalDirectories`
 * (expanded filesystem reach). `permissions.deny` is intentionally NOT risky
 * (deny-only is strictly safer than the default).
 */
export function detectRiskyProjectSettings(settings: ProjectSettingsLike | null | undefined): boolean {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  if (hasNonEmptyHooks(settings.hooks)) {
    return true;
  }

  const permissions = settings.permissions;
  if (permissions && typeof permissions === 'object') {
    const allow = permissions.allow;
    if (Array.isArray(allow) && allow.length > 0) {
      return true;
    }
    if (typeof permissions.defaultMode === 'string' && PRIVILEGE_WIDENING_MODES.has(permissions.defaultMode)) {
      return true;
    }
    const extraDirs = permissions.additionalDirectories;
    if (Array.isArray(extraDirs) && extraDirs.length > 0) {
      return true;
    }
  }

  return false;
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
  return shouldHonorProjectSettingsForRisk(
    settings,
    vaultKey,
    detectRiskyProjectSettings(projectSettings),
  );
}

/**
 * Same decision as `shouldHonorProjectSettings` but with risk precomputed. The
 * live query path detects risk once (an async `.claude/settings.json` read) at
 * workspace init and caches the boolean, so per-turn source resolution stays
 * synchronous and re-evaluates trust against the live `trustedVaults` map.
 */
export function shouldHonorProjectSettingsForRisk(
  settings: Record<string, unknown>,
  vaultKey: string,
  risky: boolean,
): boolean {
  if (!risky) {
    return true;
  }
  return isVaultTrusted(settings, vaultKey);
}
