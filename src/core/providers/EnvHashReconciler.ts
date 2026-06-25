import { createHash } from 'crypto';

import { parseEnvironmentVariables } from '../../utils/env';
import type { Conversation } from '../types';
import { getRuntimeEnvironmentText } from './providerEnvironment';
import type { EnvTextResolver, ProviderId } from './types';

/** Per-provider variation behind the environment-hash invalidation seam. */
export interface EnvHashReconcilerSpec {
  providerId: ProviderId;
  /** Environment keys whose values, when changed, invalidate existing sessions. */
  watchedKeys: readonly string[];
  getSavedHash(settings: Record<string, unknown>): string;
  saveHash(settings: Record<string, unknown>, hash: string): void;
  /** Mutates and returns true when the conversation must drop its session. */
  invalidateConversation(conversation: Conversation): boolean;
  /** Optional model fixup after an environment change, using the freshly read env text. */
  reconcileModel?(settings: Record<string, unknown>, envText: string): void;
}

/**
 * Stable, sorted `KEY=value` projection of the watched keys. This embeds the raw
 * values (including secrets) so it is NEVER persisted — it is only the pre-digest
 * input to `computeEnvHash` and the comparison basis for legacy stored hashes.
 */
function canonicalEnvProjection(envText: string, watchedKeys: readonly string[]): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return [...watchedKeys]
    .filter(key => envVars[key])
    .map(key => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

/**
 * SEC-A: a DIGEST (not the raw values) of the watched env keys. The watched set
 * includes secrets (e.g. `OPENAI_API_KEY`, `CURSOR_API_KEY`) and this hash is
 * persisted to `providerConfigs.*.environmentHash` in `specorator-settings.json`, so
 * it must never contain the resolved secret itself. An empty projection stays `''`
 * to preserve the "no env configured" sentinel (and parity with the default hash).
 */
export function computeEnvHash(envText: string, watchedKeys: readonly string[]): string {
  const canonical = canonicalEnvProjection(envText, watchedKeys);
  return canonical === '' ? '' : createHash('sha256').update(canonical).digest('hex');
}

/**
 * Deep environment-hash reconciliation shared by every provider: read the runtime
 * environment, hash the watched keys, and — only when the hash changed — invalidate
 * matching conversations, fix up the model, and persist the new hash.
 */
export function reconcileEnvironmentHash(
  spec: EnvHashReconcilerSpec,
  settings: Record<string, unknown>,
  conversations: Conversation[],
  resolveEnvText?: EnvTextResolver,
): { changed: boolean; invalidatedConversations: Conversation[] } {
  // SEC-A: hash the RESOLVED env (secrets overlaid) when available, so a watched
  // key moving from the plaintext blob into SecretStorage keeps the same value
  // and the same hash — no spurious session invalidation on upgrade/edit.
  const resolved = resolveEnvText
    ? resolveEnvText(spec.providerId)
    : { text: getRuntimeEnvironmentText(settings, spec.providerId), missingKeys: [] };

  // SEC-A: if a *watched* secret is absent on this device (e.g. a synced vault
  // opened on a new machine), this provider's hash input is incomplete — we
  // can't tell whether that watched key changed, so defer: keep the saved hash
  // and existing sessions until the user re-enters it. A missing secret that is
  // NOT one of this reconciler's watched keys does not block reconciliation.
  if (resolved.missingKeys.some((key) => spec.watchedKeys.includes(key))) {
    return { changed: false, invalidatedConversations: [] };
  }

  const currentHash = computeEnvHash(resolved.text, spec.watchedKeys);
  const savedHash = spec.getSavedHash(settings);

  if (currentHash === savedHash) {
    return { changed: false, invalidatedConversations: [] };
  }

  // SEC-A back-compat: a hash saved in the LEGACY raw-`KEY=value` format (which
  // could embed a resolved secret in plaintext settings) for the SAME values must
  // not be treated as a change. Scrub it to the digest and persist — but drop no
  // sessions — so the stale plaintext value is removed without spurious churn.
  if (savedHash !== '' && savedHash === canonicalEnvProjection(resolved.text, spec.watchedKeys)) {
    spec.saveHash(settings, currentHash);
    return { changed: true, invalidatedConversations: [] };
  }

  const invalidatedConversations: Conversation[] = [];
  for (const conversation of conversations) {
    if (spec.invalidateConversation(conversation)) {
      invalidatedConversations.push(conversation);
    }
  }

  spec.reconcileModel?.(settings, resolved.text);
  spec.saveHash(settings, currentHash);

  return { changed: true, invalidatedConversations };
}
