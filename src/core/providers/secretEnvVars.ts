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
 * Build the effective env for a provider with correct precedence (most specific
 * wins): shared plaintext < shared secret < provider plaintext < provider secret.
 * Overlaying shared secrets BEFORE the provider blob is parsed ensures a provider
 * override (e.g. `OPENAI_API_KEY=... # claudian:plaintext`) wins over a shared
 * secret of the same name. Reports refs whose secret value is absent on device.
 */
export function resolveProviderEnvVars(
  settings: Record<string, unknown>,
  providerId: ProviderId,
  resolve: SecretResolver,
): { env: Record<string, string>; missing: SecretEnvVarRef[] } {
  const refs = (settings.secretEnvVars as SecretEnvVarRef[] | undefined) ?? [];
  const env = parseEnvironmentVariables(getSharedEnvironmentVariables(settings));
  const sharedMissing = overlaySecretEnvVars(env, secretEnvVarsForScope(refs, 'shared'), resolve).missing;
  Object.assign(env, parseEnvironmentVariables(getProviderEnvironmentVariables(settings, providerId)));
  const providerMissing = overlaySecretEnvVars(
    env,
    secretEnvVarsForScope(refs, `provider:${providerId}`),
    resolve,
  ).missing;
  return { env, missing: [...sharedMissing, ...providerMissing] };
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
  // name -> ref for this scope, seeded from existing refs and extended with refs
  // created in THIS pass, so a repeated secret key reuses one ref instead of
  // allocating a duplicate (which a later edit/clear would only half-update).
  const byName = new Map<string, SecretEnvVarRef>();
  for (const ref of existingRefs) {
    if (ref.scope === scope) byName.set(ref.name, ref);
  }

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

    const tracked = byName.get(key);

    if (parsed[key] === '') {
      // Cleared in the editor (`KEY=`). Prune a persisted ref so the stale
      // SecretStorage value is no longer overlaid; un-create an in-pass ref.
      // The (now empty) line is kept as the user's explicit value.
      if (tracked) {
        if (existingRefs.includes(tracked)) {
          clearedRefs.push(tracked);
        } else {
          const i = refs.indexOf(tracked);
          if (i >= 0) refs.splice(i, 1);
        }
        byName.delete(key);
      }
      out.push(line);
      continue;
    }

    // A re-entered key (already migrated, or a duplicate line in this pass)
    // updates the SAME secret in place — never a stale duplicate ref or a
    // plaintext line.
    if (tracked) {
      setSecret(tracked.secretId, parsed[key]);
    } else {
      const id = uniquifySecretId(migratedEnvSecretId(scope, key), usedIds);
      usedIds.add(id);
      setSecret(id, parsed[key]);
      const ref: SecretEnvVarRef = { scope, name: key, secretId: id };
      refs.push(ref);
      byName.set(key, ref);
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

  // Snapshot every scoped blob BEFORE any setter mutates `settings`. The setters
  // delete the legacy `environmentVariables` field, and reading a provider blob
  // afterwards (it falls back to classifying that legacy blob) would drop
  // provider-owned lines that only lived in the legacy blob.
  const hadLegacy = typeof settings.environmentVariables === 'string'
    && (settings.environmentVariables as string).length > 0;
  const sharedBlob = getSharedEnvironmentVariables(settings);
  const providerBlobs = new Map<ProviderId, string>(
    providerIds.map((id) => [id, getProviderEnvironmentVariables(settings, id)]),
  );

  const shared = extractBlobSecretRefs(sharedBlob, 'shared', setSecret, usedIds, existing);
  // Write shared back when it changed, or to materialize the legacy blob's shared
  // portion before the legacy field is removed.
  if (shared.blob !== sharedBlob || hadLegacy) {
    setSharedEnvironmentVariables(settings, shared.blob);
    if (shared.blob !== sharedBlob) changed = true;
  }
  newRefs.push(...shared.refs);
  clearedRefs.push(...shared.clearedRefs);

  for (const providerId of providerIds) {
    const scope: EnvironmentScope = `provider:${providerId}`;
    const blob = providerBlobs.get(providerId) ?? '';
    const result = extractBlobSecretRefs(blob, scope, setSecret, usedIds, existing);
    // Write back when changed, or to materialize this provider's legacy lines.
    if (result.blob !== blob || (hadLegacy && blob.length > 0)) {
      setProviderEnvironmentVariables(settings, providerId, result.blob);
      if (result.blob !== blob) changed = true;
    }
    newRefs.push(...result.refs);
    clearedRefs.push(...result.clearedRefs);
  }

  if (hadLegacy) changed = true; // the legacy field was removed → settings changed

  if (newRefs.length > 0 || clearedRefs.length > 0) {
    // Prune only the SPECIFIC cleared refs (by identity) — the UI lets multiple
    // rows/scopes point at the same SecretStorage entry, so clearing by id alone
    // would drop unrelated refs. Clear a stored value only when no remaining ref
    // still references that id.
    const cleared = new Set(clearedRefs);
    const next = [...existing.filter((ref) => !cleared.has(ref)), ...newRefs];
    settings.secretEnvVars = next;
    const stillUsed = new Set(next.map((ref) => ref.secretId));
    for (const ref of clearedRefs) {
      if (!stillUsed.has(ref.secretId)) setSecret(ref.secretId, '');
    }
    changed = true;
  }
  return changed;
}
