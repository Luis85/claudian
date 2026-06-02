/**
 * Subprocess env allowlist shared across providers that spawn CLI subprocesses
 * (Cursor, Opencode). Adding a key here is a security decision — never add a
 * key that can change how the subprocess loads code (NODE_OPTIONS is allowed
 * because users tune memory limits; NODE_TLS_REJECT_UNAUTHORIZED is explicitly
 * never allowed because it disables certificate validation).
 */
export const SUBPROCESS_ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  // Base shell context
  'PATH',
  'HOME',
  'USERPROFILE',
  'USERNAME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  // Locale
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  // Temp paths
  'TMPDIR',
  'TMP',
  'TEMP',
  // XDG base dirs (apps look here for config/data/cache/state locations)
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  // Windows
  'COMSPEC',
  'SystemRoot',
  'SYSTEMROOT',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'WINDIR',
  // Proxies (lowercase variants matter for curl/git)
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  // TLS cert bundles
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  // Git / SSH
  'GIT_SSH_COMMAND',
  'GIT_TERMINAL_PROMPT',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  // Node runtime tuning (NOT NODE_TLS_REJECT_UNAUTHORIZED)
  'NODE_OPTIONS',
  // CI flag
  'CI',
]);

/**
 * Keys we always refuse to forward, even if a future allowlist change picks
 * them up by accident. Acts as a kill-switch.
 */
export const SUBPROCESS_ENV_DENYLIST: ReadonlySet<string> = new Set([
  'NODE_TLS_REJECT_UNAUTHORIZED',
]);

export interface BuildAllowlistedSubprocessEnvironmentOptions {
  processEnv: Record<string, string | undefined>;
  customEnv: Record<string, string>;
  /** Provider-scoped prefix that should always pass through (e.g. /^CURSOR_/i, /^OPENCODE_/i). */
  providerPrefixPattern: RegExp;
  /** Optional override of the PATH key — providers may want to enhance PATH. */
  pathOverride?: string;
}

export function buildAllowlistedSubprocessEnvironment(
  opts: BuildAllowlistedSubprocessEnvironmentOptions,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.processEnv)) {
    if (value === undefined) continue;
    if (SUBPROCESS_ENV_DENYLIST.has(key)) continue;
    const passesAllowlist = SUBPROCESS_ENV_ALLOWLIST.has(key);
    const passesPrefix = opts.providerPrefixPattern.test(key);
    if (!passesAllowlist && !passesPrefix) continue;
    out[key] = value;
  }
  // customEnv is user-opt-in; pass everything in it (including unlisted keys)
  // but still apply the denylist so users cannot accidentally re-enable TLS bypass.
  for (const [key, value] of Object.entries(opts.customEnv)) {
    if (SUBPROCESS_ENV_DENYLIST.has(key)) continue;
    out[key] = value;
  }
  if (opts.pathOverride !== undefined) {
    out.PATH = opts.pathOverride;
  }
  return out;
}
