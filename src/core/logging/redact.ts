// `pin` is anchored to a delimited token so it does not match innocuous keys
// that merely contain the substring (shipping, mapping, spinner, ...).
const SECRET_KEY =
  /(token|key|secret|password|passwd|pwd|credential|api[-_]?key|authorization|bearer|cookie|signature|private[-_]?key|(?<![a-z])pin(?![a-z]))/i;
const REDACTED = '[redacted]';

/** Deep-clone args, masking secret-shaped object keys. Never mutates inputs. */
export function redactArgs(args: unknown[]): unknown[] {
  return args.map((arg) => redactValue(arg, new WeakSet()));
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
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
