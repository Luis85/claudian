// Single source of truth for namespacing Cursor model picker VALUES.
//
// The app builds one combined model picker from every enabled provider and
// routes a selected model id to a provider via the first `ownsModel(id)` that
// returns true. Cursor now discovers third-party ids (e.g. `gpt-5.5`,
// `claude-4.5-sonnet`) that other providers also claim. To keep routing
// unambiguous, every Cursor picker value is namespaced with a `cursor:` prefix;
// only Cursor's `ownsModel` matches `cursor:*`. The raw id is stripped before
// it reaches the CLI `--model` flag.
export const CURSOR_MODEL_PREFIX = 'cursor:';

/** Returns `cursor:<rawId>`. Idempotent: already-prefixed input is returned as-is. */
export function toCursorModelValue(rawId: string): string {
  const trimmed = rawId.trim();
  if (trimmed.startsWith(CURSOR_MODEL_PREFIX)) {
    return trimmed;
  }
  return `${CURSOR_MODEL_PREFIX}${trimmed}`;
}

/** Strips a single leading `cursor:` prefix and trims; returns the raw id. */
export function fromCursorModelValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith(CURSOR_MODEL_PREFIX)) {
    return trimmed.slice(CURSOR_MODEL_PREFIX.length).trim();
  }
  return trimmed;
}

/** True when the value carries the `cursor:` namespace prefix. */
export function isCursorModelValue(value: string): boolean {
  return value.startsWith(CURSOR_MODEL_PREFIX);
}
