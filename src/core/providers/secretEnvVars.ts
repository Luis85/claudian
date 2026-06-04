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
import { isClaudianGeneratedSecretId, isSecretEnvKey, migratedEnvSecretId, SECRET_VALUE_PLACEHOLDER, uniquifySecretId } from '../security/secretIds';
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
  const sharedRefs = secretEnvVarsForScope(refs, 'shared');
  const providerRefs = secretEnvVarsForScope(refs, `provider:${providerId}`);

  const env = parseEnvironmentVariables(getSharedEnvironmentVariables(settings));
  const sharedMissing = overlaySecretEnvVars(env, sharedRefs, resolve).missing;

  const providerEnv = parseEnvironmentVariables(getProviderEnvironmentVariables(settings, providerId));
  Object.assign(env, providerEnv);
  const providerMissing = overlaySecretEnvVars(env, providerRefs, resolve).missing;

  // Names supplied at PROVIDER precedence (provider plaintext, or a present
  // provider secret) — higher precedence than a shared secret.
  const providerMissingSet = new Set(providerMissing);
  const providerSupplied = new Set<string>();
  for (const [name, value] of Object.entries(providerEnv)) {
    if (value !== '') providerSupplied.add(name);
  }
  for (const ref of providerRefs) {
    if (!providerMissingSet.has(ref)) providerSupplied.add(ref.name);
  }

  // A missing SHARED secret is moot only if a higher-precedence provider source
  // supplies the same name. A missing PROVIDER secret is the most specific
  // source, so it is always reported — a lower-precedence shared value must not
  // silently satisfy it (the provider launch would use the wrong credential).
  const missing = [
    ...sharedMissing.filter((ref) => !providerSupplied.has(ref.name)),
    ...providerMissing,
  ];

  // When the highest-precedence configured source for a name is a secret that is
  // missing on this device, OMIT the name rather than leak a lower-precedence
  // value (e.g. launching with a shared key when the provider-specific secret the
  // user configured is just absent here). A provider secret is the top source, so
  // a missing one masks everything lower; a missing shared secret is masked only
  // when no higher provider source supplies the name.
  for (const ref of providerMissing) {
    delete env[ref.name];
  }
  for (const ref of sharedMissing) {
    if (!providerSupplied.has(ref.name)) delete env[ref.name];
  }
  return { env, missing };
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
 * One-time migration across the shared blob, each provider's blob, and every
 * saved snippet's `envVars`. Mutates `settings` in place (sanitized blobs +
 * appended `secretEnvVars`) and returns whether anything changed. Idempotent —
 * re-running finds no plaintext secrets and is a cheap no-op.
 *
 * Snippet secrets are migrated under a `snippet:<id>` scope, which resolution
 * (`resolveProviderEnvVars`) deliberately ignores — snippets are inert templates,
 * so a migrated key must NOT become active at launch. The value is re-injected
 * only when the snippet is inserted (`resolveSnippetEnvText`), at which point the
 * apply path migrates it into the active shared/provider scope.
 */
export interface MigrationSecretStore {
  set(id: string, value: string): void;
  /** All ids already present in SecretStorage (this vault's keychain). */
  list(): string[];
}

/**
 * Provider-owned structured settings fields that hold a plaintext secret. SEC-A
 * migrates each into a `provider:<id>` secret ref under `envName` and removes the
 * field. (Codex's `apiKey` was also dead — never read — so this additionally makes
 * a previously-entered key take effect via the env overlay.)
 */
const PROVIDER_CONFIG_SECRET_FIELDS: ReadonlyArray<{ providerId: ProviderId; field: string; envName: string }> = [
  { providerId: 'codex', field: 'apiKey', envName: 'OPENAI_API_KEY' },
];

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

  // Saved snippets: migrate secret-shaped lines into a `snippet:<id>` scope so the
  // value leaves the plaintext settings file. These refs stay inert at launch and
  // are materialized on insert (see resolveSnippetEnvText).
  const snippets: Array<{ id?: unknown; envVars?: unknown }> = Array.isArray(settings.envSnippets)
    ? settings.envSnippets
    : [];
  for (const snippet of snippets) {
    if (!snippet || typeof snippet.id !== 'string' || typeof snippet.envVars !== 'string') {
      continue;
    }
    const scope: EnvironmentScope = `snippet:${snippet.id}`;
    const blob = snippet.envVars;
    const result = extractBlobSecretRefs(blob, scope, setSecret, usedIds, existing);
    if (result.blob !== blob) {
      snippet.envVars = result.blob;
      changed = true;
    }
    newRefs.push(...result.refs);
    clearedRefs.push(...result.clearedRefs);
  }

  if (hadLegacy) changed = true; // the legacy field was removed → settings changed

  // Provider-owned STRUCTURED secret fields (not env blobs): translate any
  // plaintext value into a provider-scoped secret ref and strip the field, so the
  // key leaves the settings file. A value already covered by an existing ref of the
  // same scope/name is just stripped (that ref wins). Today this is only Codex's
  // dead `apiKey` field; migrating it as OPENAI_API_KEY also makes it take effect.
  const providerConfigs = settings.providerConfigs as Record<string, Record<string, unknown>> | undefined;
  if (providerConfigs) {
    for (const { providerId, field, envName } of PROVIDER_CONFIG_SECRET_FIELDS) {
      const config = providerConfigs[providerId];
      const value = config?.[field];
      if (typeof value !== 'string' || value.length === 0) continue;
      const scope: EnvironmentScope = `provider:${providerId}`;
      const alreadyCovered =
        existing.some((ref) => ref.scope === scope && ref.name === envName) ||
        newRefs.some((ref) => ref.scope === scope && ref.name === envName);
      if (!alreadyCovered) {
        const id = uniquifySecretId(migratedEnvSecretId(scope, envName), usedIds);
        usedIds.add(id);
        setSecret(id, value);
        newRefs.push({ scope, name: envName, secretId: id });
      }
      delete config[field];
      changed = true;
    }
  }

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
      // Mirror the settings UI's clearIfOrphaned guard: SecretStorage ids are
      // global across plugins and a ref may point at a user-selected external id
      // (via SecretComponent), so only auto-erase Claudian-owned ids — never a
      // secret another plugin owns.
      if (!isClaudianGeneratedSecretId(ref.secretId)) continue;
      if (!stillUsed.has(ref.secretId)) setSecret(ref.secretId, '');
    }
    changed = true;
  }
  return changed;
}

/**
 * SEC-A: rebuild a snippet's env text for INSERTION by re-injecting the values of
 * its migrated secrets (held under `snippet:<id>` refs). Snippet secrets are inert
 * at launch — this is the only path that materializes them. A secret absent on
 * this device is reported in `missing` and omitted (so insertion never writes an
 * empty value); the user re-enters it. The sanitized snippet text is preserved
 * verbatim; resolved `NAME=value` lines are appended.
 */
export function resolveSnippetEnvText(
  envVars: string,
  refs: SecretEnvVarRef[],
  resolve: SecretResolver,
): { envText: string; missing: SecretEnvVarRef[] } {
  const missing: SecretEnvVarRef[] = [];
  const lines: string[] = [];
  const base = envVars.replace(/\s+$/, '');
  if (base) lines.push(base);
  for (const ref of refs) {
    const value = resolve(ref.secretId);
    if (value === null || value === '') {
      missing.push(ref);
      continue;
    }
    lines.push(`${ref.name}=${value}`);
  }
  return { envText: lines.join('\n'), missing };
}

/**
 * SEC-A: reconcile an edited snippet `envVars` (shown in the editor with a masked
 * placeholder row per existing secret) against the snippet's secret refs. Returns
 * the env text to store (placeholder rows stripped; real values kept for
 * re-migration) and the set of ref names to KEEP. A ref whose key is left as the
 * placeholder or re-entered with a real value is kept; a ref whose key the user
 * deleted or emptied (`KEY=`) is absent from `keptRefNames` so the caller prunes
 * it — otherwise a removed snippet credential would be re-injected on insert.
 */
export function reconcileSnippetEdit(
  editedEnvVars: string,
  snippetRefs: SecretEnvVarRef[],
): { envVars: string; keptRefNames: Set<string> } {
  const refByName = new Map(snippetRefs.map((ref) => [ref.name, ref]));
  const keptRefNames = new Set<string>();
  const lines: string[] = [];

  for (const line of editedEnvVars.split(/\r?\n/)) {
    const parsed = parseEnvironmentVariables(line);
    const key = Object.keys(parsed)[0];
    if (key && refByName.has(key)) {
      if (parsed[key] === SECRET_VALUE_PLACEHOLDER) {
        keptRefNames.add(key); // unchanged secret → keep ref, drop the placeholder line
        continue;
      }
      if (parsed[key] !== '') {
        keptRefNames.add(key); // re-entry → keep ref (migration reuses the id), keep line
      }
      // `KEY=` (emptied) → not kept → caller prunes the ref
    }
    lines.push(line);
  }

  return { envVars: lines.join('\n'), keptRefNames };
}

/**
 * SEC-A: remove every secret ref for a scope (e.g. a deleted snippet) from
 * `settings.secretEnvVars` and clear each stored value no remaining ref still
 * references. Returns whether the refs changed. Values shared with another scope
 * (the UI allows reusing one SecretStorage entry) are left intact.
 */
export function pruneScopeSecretRefs(
  settings: Record<string, unknown>,
  scope: EnvironmentScope,
  clearValue: (id: string) => void,
): boolean {
  const existing = (settings.secretEnvVars as SecretEnvVarRef[] | undefined) ?? [];
  const pruned = existing.filter((ref) => ref.scope === scope);
  if (pruned.length === 0) return false;

  const next = existing.filter((ref) => ref.scope !== scope);
  settings.secretEnvVars = next;
  const stillUsed = new Set(next.map((ref) => ref.secretId));
  for (const ref of pruned) {
    if (!stillUsed.has(ref.secretId)) clearValue(ref.secretId);
  }
  return true;
}
