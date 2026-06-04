/**
 * SECURITY (SEC-A): pure helpers for the structured secret model. No I/O, no
 * Obsidian imports — fully unit-tested in isolation. The keychain-backed value
 * store is `secretStore.ts`.
 *
 * Steady state uses Obsidian's `SecretComponent`, which owns secret naming, so
 * there is no in-file token or blob rewriting. These helpers exist for the
 * one-time MIGRATION of pre-existing plaintext secrets: derive a valid,
 * namespaced SecretStorage id for a value we move out of the vault files, and
 * (advisory only) suggest which existing entries look secret for the user to
 * confirm. Detection is never used to silently classify in steady state.
 */

/**
 * Normalize an arbitrary string into a valid SecretStorage id (the API requires
 * lowercase alphanumeric + dashes): lowercase, non-`[a-z0-9]` collapsed to
 * dashes, no leading/trailing or doubled dashes. (Stateless regex — the right
 * tool for character-class cleanup.)
 */
export function normalizeSecretId(raw: string): string {
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return id || 'secret';
}

// Claudian namespaces every id it creates so it never clobbers another plugin's
// secret in Obsidian's GLOBAL (cross-plugin) id space.
const CLAUDIAN_PREFIX = 'claudian';

/** Stable id for an env var value migrated out of a blob. `scope` is `shared` or a snippet id. */
export function migratedEnvSecretId(scope: string, key: string): string {
  return normalizeSecretId(`${CLAUDIAN_PREFIX}-env-${scope}-${key}`);
}

/** Stable id for an MCP auth header value migrated out of `.claude/mcp.json`. */
export function migratedMcpHeaderSecretId(serverName: string, headerName: string): string {
  return normalizeSecretId(`${CLAUDIAN_PREFIX}-mcp-${serverName}-header-${headerName}`);
}

/** Return `base`, or `base-2`, `base-3`, … if already taken (migration collision-proofing). */
export function uniquifySecretId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Known provider secret env keys (exact match) plus a suffix heuristic. Used
// ONLY to suggest migration candidates the user confirms — never to auto-classify.
const KNOWN_SECRET_ENV_KEYS = new Set(
  [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'MISTRAL_API_KEY',
    'DEEPSEEK_API_KEY',
    'XAI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SESSION_TOKEN',
  ].map((k) => k.toUpperCase()),
);

const SECRET_ENV_SUFFIX_RE = /(?:_|^)(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|AUTH|CREDENTIALS?)$/;

/** Migration heuristic (advisory): does this env var name likely hold a secret value? */
export function isSecretEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (KNOWN_SECRET_ENV_KEYS.has(upper)) return true;
  return SECRET_ENV_SUFFIX_RE.test(upper);
}

/** Migration heuristic (advisory): does this MCP header name carry credentials? */
export function isSecretHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === 'authorization' || lower === 'proxy-authorization' || lower === 'cookie') return true;
  return /(api[-_]?key|token|secret|auth|password|credential)/.test(lower);
}
