import os from 'os';

// `pin` is anchored to a delimited token so it does not match innocuous keys
// that merely contain the substring (shipping, mapping, spinner, ...).
const SECRET_KEY =
  /(token|key|secret|password|passwd|pwd|credential|api[-_]?key|authorization|bearer|cookie|signature|private[-_]?key|(?<![a-z])pin(?![a-z]))/i;
const REDACTED = '[redacted]';

// Value-level scrubbers. Every pattern is bounded (capped `{n,m}` repetition on a
// restricted character class, no nested quantifiers) so adversarial log bodies
// cannot trigger catastrophic backtracking. Secret material is typically a single
// unbroken token, so a bounded run is sufficient without scanning unbounded input.
const VALUE_SCRUBBERS: Array<{ pattern: RegExp; replace: string }> = [
  // `Bearer <token>` / `Authorization: Bearer <token>` headers.
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{6,512}/gi, replace: 'Bearer [redacted]' },
  // `token=` / `api_key=` / `api-key=` / `apikey=` style key/value pairs in
  // query strings, command args, and dumps. Stops at common delimiters.
  {
    pattern: /\b(api[-_]?key|token|secret|password|access[-_]?token)=[^\s&"'`)]{1,512}/gi,
    replace: '$1=[redacted]',
  },
  // Provider key shapes: `sk-...`, `sk-ant-...`, `sk-proj-...`, `ghp_...`, etc.
  { pattern: /\bsk-[A-Za-z0-9_-]{8,512}/g, replace: REDACTED },
  { pattern: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,512}/g, replace: REDACTED },
  // `user:pass@host` credentials in URLs / clone commands. Keep the host; mask
  // both user and password since either half can be sensitive.
  {
    pattern: /([a-z][a-z0-9+.-]{0,32}:\/\/)[^\s/@:]{1,256}:[^\s/@]{1,256}@/gi,
    replace: '$1[redacted]@',
  },
];

/** Scrub secret-shaped substrings from a value and normalize the home path. */
export function scrubString(text: string): string {
  let out = text;
  for (const { pattern, replace } of VALUE_SCRUBBERS) {
    out = out.replace(pattern, replace);
  }
  return normalizeHome(out);
}

function normalizeHome(text: string): string {
  const home = os.homedir();
  // homedir() can be empty/'/' on odd hosts; skip to avoid corrupting paths.
  if (!home || home === '/' || !text.includes(home)) return text;
  return text.split(home).join('~');
}

/** Deep-clone args, masking secret-shaped object keys. Never mutates inputs. */
export function redactArgs(args: unknown[]): unknown[] {
  return args.map((arg) => redactValue(arg, new WeakSet()));
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(val, seen);
  }
  return out;
}

/** Truncate a string body, annotating dropped characters. */
export function truncateBody(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[+${text.length - maxChars}]`;
}
