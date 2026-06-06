import type { ProviderId } from '../providers/types';
import type { UsageEntryKind, UsageKey } from './types';

const QUICK_ACTION_PROVIDER_SLOT = '_';
const KINDS: readonly UsageEntryKind[] = ['quickAction', 'skill'];

/**
 * Composite-key format: `${kind}:${providerSlot}:${name}`.
 *
 * **Invariants** (enforced by callers, not the encoder):
 * - `kind` is `'quickAction'` or `'skill'` (parser rejects others).
 * - `providerSlot` MUST NOT contain `:`. In practice this is always
 *   `'_'` (quick-action sentinel) or a `ProviderId` enum value
 *   (`'claude' | 'codex' | 'opencode' | 'cursor'`), so the constraint
 *   is structural.
 * - `name` MAY contain `:` (skill names live in filesystems where `:`
 *   is illegal on Windows but legal on POSIX; `parseKey` takes the
 *   tail after the second `:` so any trailing colons round-trip cleanly).
 *
 * If a future ProviderId ever introduces `:` the format would alias
 * silently — `parseKey` would split at the first `:` of the provider
 * slot. Switch encoding (escape, length prefix, or `\x1f` delimiter)
 * before that happens.
 */
export function serializeKey(key: UsageKey): string {
  const providerSlot = key.providerId ?? QUICK_ACTION_PROVIDER_SLOT;
  return `${key.kind}:${providerSlot}:${key.name}`;
}

export function parseKey(serialized: string): UsageKey | null {
  const firstSep = serialized.indexOf(':');
  if (firstSep <= 0) return null;
  const secondSep = serialized.indexOf(':', firstSep + 1);
  if (secondSep <= firstSep) return null;

  const kind = serialized.slice(0, firstSep) as UsageEntryKind;
  if (!KINDS.includes(kind)) return null;

  const providerSlot = serialized.slice(firstSep + 1, secondSep);
  const name = serialized.slice(secondSep + 1);
  if (!name) return null;

  if (providerSlot === QUICK_ACTION_PROVIDER_SLOT) {
    return { kind, name };
  }
  return { kind, name, providerId: providerSlot as ProviderId };
}
