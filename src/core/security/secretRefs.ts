/**
 * SECURITY (SEC-A): pure helpers for moving secret *values* out of vault files
 * and leaving references behind. No I/O, no Obsidian imports — fully unit-tested
 * in isolation. The keychain-backed value store is `secretStore.ts`.
 *
 * Reference token (Claudian-owned, used in our own files such as
 * `.claudian/claudian-settings.json`): `${secret:<id>}` where `<id>` is a
 * SecretStorage-valid id (lowercase alphanumeric + dashes).
 */

/** Matches a Claudian secret reference token and captures the id. */
export const SECRET_REF_RE = /\$\{secret:([a-z0-9-]+)\}/g;

/** Inline opt-out marker: keep this env line in plaintext (power-user escape). */
const PLAINTEXT_OPT_OUT = /#\s*claudian:plaintext\s*$/;

/** Build the reference token for an id. */
export function secretRef(id: string): string {
  return `\${secret:${id}}`;
}

// `SECRET_REF_RE` is global, so `.test()`/`.matchAll()` are stateful via
// `lastIndex`. These helpers reset before AND after use so a prior call can
// never make the next one start mid-string (which would drop the first ref).
/** True if the text already contains a secret reference token. */
export function hasSecretRef(text: string): boolean {
  SECRET_REF_RE.lastIndex = 0;
  const found = SECRET_REF_RE.test(text);
  SECRET_REF_RE.lastIndex = 0;
  return found;
}

/** Collect the ids referenced in a piece of text. */
export function findSecretRefs(text: string): string[] {
  SECRET_REF_RE.lastIndex = 0;
  const ids: string[] = [];
  for (const m of text.matchAll(SECRET_REF_RE)) {
    ids.push(m[1]);
  }
  SECRET_REF_RE.lastIndex = 0;
  return ids;
}

/**
 * Normalize an arbitrary string into a valid SecretStorage id: lowercase,
 * non-`[a-z0-9-]` collapsed to dashes, no leading/trailing or doubled dashes.
 */
export function normalizeSecretId(raw: string): string {
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return id || 'secret';
}

// Known provider secret env keys (exact match) plus a suffix heuristic.
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

const SECRET_ENV_SUFFIX_RE = /(?:_|^)(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?)$/;

/** Heuristic: does this env var name hold a secret value? */
export function isSecretEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (KNOWN_SECRET_ENV_KEYS.has(upper)) return true;
  return SECRET_ENV_SUFFIX_RE.test(upper);
}

/** Heuristic: does this MCP header name carry credentials? */
export function isSecretHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === 'authorization' || lower === 'proxy-authorization' || lower === 'cookie') return true;
  return /(api[-_]?key|token|secret|auth|password|credential)/.test(lower);
}

export interface ExtractedSecret {
  id: string;
  value: string;
}

export interface EnvBlobExtraction {
  /** The blob with secret values replaced by `${secret:<id>}` references. */
  blob: string;
  /** Secrets to persist in the keychain. */
  secrets: ExtractedSecret[];
}

interface ParsedEnvLine {
  key: string;
  value: string;
}

/** Parse a `KEY=VALUE` env line (ignoring `export ` prefix). Returns null for non-assignments. */
function parseEnvAssignment(line: string): ParsedEnvLine | null {
  const withoutExport = line.replace(/^\s*export\s+/, '');
  const eq = withoutExport.indexOf('=');
  if (eq <= 0) return null;
  const key = withoutExport.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value: withoutExport.slice(eq + 1) };
}

/**
 * Extract secret-valued env lines from a `KEY=VALUE\n…` blob, replacing each
 * secret value with a `${secret:<id>}` reference. Pure and idempotent: lines
 * already referencing a secret, empty values, opted-out lines (`# claudian:plaintext`),
 * and non-secret keys pass through untouched.
 *
 * @param makeId derives a stable, valid id from the env key (scope-aware; caller-supplied).
 */
export function extractEnvBlobSecrets(blob: string, makeId: (key: string) => string): EnvBlobExtraction {
  const secrets: ExtractedSecret[] = [];
  // Seed with ids already referenced in this blob so newly-extracted secrets
  // never collide with an existing reference (or with each other) after
  // normalization (e.g. `FOO_TOKEN` and `FOO__TOKEN` both normalize alike).
  const used = new Set<string>(findSecretRefs(blob));
  const out = blob.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    if (PLAINTEXT_OPT_OUT.test(line)) return line;

    const parsed = parseEnvAssignment(line);
    if (!parsed) return line;
    if (!isSecretEnvKey(parsed.key)) return line;

    const rawValue = parsed.value;
    if (rawValue.trim() === '') return line;
    if (hasSecretRef(rawValue)) return line; // already a reference

    // Strip surrounding quotes for the stored value; keep it simple/explicit.
    const unquoted = rawValue.replace(/^(['"])([\s\S]*)\1\s*$/, '$2');
    const id = uniquifySecretId(normalizeSecretId(makeId(parsed.key)), used);
    used.add(id);
    secrets.push({ id, value: unquoted });
    return `${parsed.key}=${secretRef(id)}`;
  });
  return { blob: out.join('\n'), secrets };
}

/** Return `base`, or `base-2`, `base-3`, … if already taken. */
function uniquifySecretId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Resolve `${secret:<id>}` references in a blob back to their values. Missing
 * secrets resolve to an empty string (caller can pre-scan with `findSecretRefs`
 * to detect dangling references and prompt re-entry).
 */
export function resolveEnvBlob(blob: string, get: (id: string) => string | null): string {
  return blob.replace(SECRET_REF_RE, (_match, id: string) => get(id) ?? '');
}
