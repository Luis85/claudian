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

export function computeEnvHash(envText: string, watchedKeys: readonly string[]): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return [...watchedKeys]
    .filter(key => envVars[key])
    .map(key => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
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

  if (currentHash === spec.getSavedHash(settings)) {
    return { changed: false, invalidatedConversations: [] };
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
