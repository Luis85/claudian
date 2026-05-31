export function readPath<T = unknown>(source: unknown, dottedId: string): T | undefined {
  const parts = dottedId.split('.');
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current as T | undefined;
}

export function writePath<T extends object>(source: T, dottedId: string, value: unknown): T {
  const parts = dottedId.split('.');
  if (parts.length === 0) {
    return source;
  }
  const next: Record<string, unknown> = { ...(source as unknown as Record<string, unknown>) };
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = cursor[key];
    const child: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[key] = child;
    cursor = child;
  }
  cursor[parts[parts.length - 1]] = value;
  return next as T;
}

/**
 * In-place dotted-path write. Mutates `target` so callers that hold the same
 * reference (e.g. `plugin.settings`) see the change without reassignment.
 * `writePath` returns a new object via spread — that breaks settings flow
 * because `ctx.saveSettings()` serializes `plugin.settings`, not the new
 * reference assigned to `ctx.settings`. Use this when you need the change to
 * stick on the live settings instance.
 */
export function writePathInPlace(target: object, dottedId: string, value: unknown): void {
  const parts = dottedId.split('.');
  if (parts.length === 0) return;
  let cursor = target as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = cursor[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}
