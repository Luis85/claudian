/**
 * SECURITY (SEC-A): structured secret env-var helpers — pure, testable, no I/O.
 *
 * Steady state: secret values live in Obsidian SecretStorage; settings hold only
 * `SecretEnvVarRef`s (scope + var name + secret id). At launch we OVERLAY the
 * resolved values onto the parsed (non-secret) env dict.
 *
 * Migration (one-time): EXTRACT secret-shaped plaintext lines out of an existing
 * env blob into the store and return the sanitized blob plus the new refs.
 */
import { parseEnvironmentVariables } from '../../utils/env';
import { isSecretEnvKey, migratedEnvSecretId, uniquifySecretId } from '../security/secretIds';
import type { EnvironmentScope, SecretEnvVarRef } from '../types/settings';
import {
  getProviderEnvironmentVariables,
  getSharedEnvironmentVariables,
  setProviderEnvironmentVariables,
  setSharedEnvironmentVariables,
} from './providerEnvironment';
import type { ProviderId } from './types';

export type SecretResolver = (id: string) => string | null;
export type SecretSetter = (id: string, value: string) => void;

/** Inline opt-out marker: leave this env line in plaintext (power-user escape). */
const PLAINTEXT_OPT_OUT = /#\s*claudian:plaintext\s*$/;

/** Refs that apply to a given scope. */
export function secretEnvVarsForScope(refs: SecretEnvVarRef[], scope: EnvironmentScope): SecretEnvVarRef[] {
  return refs.filter((ref) => ref.scope === scope);
}

/**
 * Overlay resolved secret values onto a parsed env dict (mutating it). A ref that
 * resolves to `null`/empty (cleared, or absent on this device) is reported in
 * `missing` and NOT injected — callers prompt the user to re-enter rather than
 * launch with an empty key.
 */
export function overlaySecretEnvVars(
  env: Record<string, string>,
  refs: SecretEnvVarRef[],
  resolve: SecretResolver,
): { missing: SecretEnvVarRef[] } {
  const missing: SecretEnvVarRef[] = [];
  for (const ref of refs) {
    const value = resolve(ref.secretId);
    if (value === null || value === '') {
      missing.push(ref);
      continue;
    }
    env[ref.name] = value;
  }
  return { missing };
}

/**
 * One-time migration for a single env blob: move secret-shaped `KEY=VALUE` lines
 * into the store and drop them from the blob. Non-secret lines, comments, blank
 * lines, opted-out lines (`# claudian:plaintext`), and empty values pass through.
 * Reuses the canonical `parseEnvironmentVariables` parser. Idempotent: a blob
 * with no plaintext secrets yields zero refs and an unchanged body.
 *
 * @param usedIds seed with already-used secret ids (across scopes/refs) so derived
 *   ids never collide; this function adds the ids it allocates.
 */
export function extractBlobSecretRefs(
  blob: string,
  scope: EnvironmentScope,
  setSecret: SecretSetter,
  usedIds: Set<string>,
  existingRefs: SecretEnvVarRef[] = [],
): { blob: string; refs: SecretEnvVarRef[]; clearedRefs: SecretEnvVarRef[] } {
  const refs: SecretEnvVarRef[] = [];
  const clearedRefs: SecretEnvVarRef[] = [];
  const out: string[] = [];

  for (const line of blob.split(/\r?\n/)) {
    if (PLAINTEXT_OPT_OUT.test(line)) {
      out.push(line);
      continue;
    }
    // A single line yields at most one key via the canonical parser.
    const parsed = parseEnvironmentVariables(line);
    const key = Object.keys(parsed)[0];
    if (!key || !isSecretEnvKey(key)) {
      out.push(line);
      continue;
    }

    const existing = existingRefs.find((ref) => ref.scope === scope && ref.name === key);

    if (parsed[key] === '') {
      // Cleared in the editor (`KEY=`). If it was a migrated secret, prune its
      // ref so the stale SecretStorage value is no longer overlaid at launch.
      // The (now empty) line is kept as the user's explicit value.
      if (existing) clearedRefs.push(existing);
      out.push(line);
      continue;
    }

    // A re-entered key (already migrated) updates its existing secret in place,
    // keeping the same id/ref — so editing a key in the textarea never leaves a
    // stale SecretStorage value winning over the new one, nor a plaintext line.
    if (existing) {
      setSecret(existing.secretId, parsed[key]);
    } else {
      const id = uniquifySecretId(migratedEnvSecretId(scope, key), usedIds);
      usedIds.add(id);
      setSecret(id, parsed[key]);
      refs.push({ scope, name: key, secretId: id });
    }
    // Drop the secret line from the sanitized blob (either way).
  }

  return { blob: out.join('\n'), refs, clearedRefs };
}

/**
 * One-time migration across the ACTIVE env blobs: the shared blob and each
 * provider's blob. Mutates `settings` in place (sanitized blobs + appended
 * `secretEnvVars`) and returns whether anything changed. Idempotent — re-running
 * finds no plaintext secrets and is a cheap no-op.
 *
 * Deliberately does NOT touch `envSnippets[].envVars`: snippets are inert
 * templates applied on demand, so a `shared`/`provider:<id>` ref would make the
 * key active immediately. Snippet secrets stay plaintext until a follow-up adds
 * a snippet-scoped association — see the SEC-A plan.
 */
export interface MigrationSecretStore {
  set(id: string, value: string): void;
  /** All ids already present in SecretStorage (this vault's keychain). */
  list(): string[];
}

export function migrateEnvSecrets(
  settings: Record<string, unknown>,
  providerIds: ProviderId[],
  store: MigrationSecretStore,
): boolean {
  const existing = (settings.secretEnvVars as SecretEnvVarRef[] | undefined) ?? [];
  // Seed from existing refs AND every id already in SecretStorage, so a derived
  // id can never overwrite an unrelated secret. Obsidian's id space is shared
  // across plugins within a vault, so a same-named secret from another plugin
  // (or a stale id) must not be clobbered.
  const usedIds = new Set<string>([...existing.map((ref) => ref.secretId), ...store.list()]);
  const setSecret: SecretSetter = (id, value) => store.set(id, value);
  const newRefs: SecretEnvVarRef[] = [];
  const clearedRefs: SecretEnvVarRef[] = [];
  let changed = false;

  const sharedBlob = getSharedEnvironmentVariables(settings);
  const shared = extractBlobSecretRefs(sharedBlob, 'shared', setSecret, usedIds, existing);
  if (shared.blob !== sharedBlob) {
    setSharedEnvironmentVariables(settings, shared.blob);
    changed = true;
  }
  newRefs.push(...shared.refs);
  clearedRefs.push(...shared.clearedRefs);

  for (const providerId of providerIds) {
    const scope: EnvironmentScope = `provider:${providerId}`;
    const blob = getProviderEnvironmentVariables(settings, providerId);
    const result = extractBlobSecretRefs(blob, scope, setSecret, usedIds, existing);
    if (result.blob !== blob) {
      setProviderEnvironmentVariables(settings, providerId, result.blob);
      changed = true;
    }
    newRefs.push(...result.refs);
    clearedRefs.push(...result.clearedRefs);
  }

  if (newRefs.length > 0 || clearedRefs.length > 0) {
    const clearedIds = new Set(clearedRefs.map((ref) => ref.secretId));
    settings.secretEnvVars = [...existing.filter((ref) => !clearedIds.has(ref.secretId)), ...newRefs];
    for (const ref of clearedRefs) {
      setSecret(ref.secretId, ''); // clear the now-unreferenced stored value
    }
    changed = true;
  }
  return changed;
}
