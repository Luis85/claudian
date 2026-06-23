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
import { parseEnvironmentVariables, PLAINTEXT_OPT_OUT_MARKER } from '../../utils/env';
import { isSpecoratorGeneratedSecretId, isSecretEnvKey, migratedEnvSecretId, SECRET_VALUE_PLACEHOLDER, uniquifySecretId } from '../security/secretIds';
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
 * override (e.g. `OPENAI_API_KEY=... # specorator:plaintext`) wins over a shared
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
 * name -> ref bookkeeping for one extraction pass over one scope, seeded from
 * existing refs and extended with refs created in THIS pass, so a repeated secret
 * key reuses one ref instead of allocating a duplicate (which a later edit/clear
 * would only half-update).
 */
class ScopeRefTracker {
  readonly refs: SecretEnvVarRef[] = [];
  readonly clearedRefs: SecretEnvVarRef[] = [];
  private readonly byName = new Map<string, SecretEnvVarRef>();

  constructor(private readonly existingRefs: SecretEnvVarRef[], scope: EnvironmentScope) {
    for (const ref of existingRefs) {
      if (ref.scope === scope) this.byName.set(ref.name, ref);
    }
  }

  get(name: string): SecretEnvVarRef | undefined {
    return this.byName.get(name);
  }

  add(ref: SecretEnvVarRef): void {
    this.refs.push(ref);
    this.byName.set(ref.name, ref);
  }

  /** Prune a tracked ref: clear a persisted ref; un-create an in-pass ref. */
  prune(name: string): void {
    const tracked = this.byName.get(name);
    if (!tracked) return;
    if (this.existingRefs.includes(tracked)) {
      this.clearedRefs.push(tracked);
    } else {
      const i = this.refs.indexOf(tracked);
      if (i >= 0) this.refs.splice(i, 1);
    }
    this.byName.delete(name);
  }
}

/**
 * One-time migration for a single env blob: move secret-shaped `KEY=VALUE` lines
 * into the store and drop them from the blob. Non-secret lines, comments, blank
 * lines, opted-out lines (`# specorator:plaintext`), and empty values pass through.
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
  const tracker = new ScopeRefTracker(existingRefs, scope);
  const out: string[] = [];

  for (const line of blob.split(/\r?\n/)) {
    if (PLAINTEXT_OPT_OUT_MARKER.test(line)) {
      // Opted out of migration: keep the plaintext line verbatim. But if this key
      // was previously migrated, PRUNE the now-stale ref — otherwise the resolver
      // overlays the old SecretStorage value on top of (or, when absent, deletes)
      // the opted-out plaintext, so the escape hatch could never replace/recover it.
      const optedOutKey = Object.keys(parseEnvironmentVariables(line))[0];
      if (optedOutKey) tracker.prune(optedOutKey);
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

    if (parsed[key] === '') {
      // Cleared in the editor (`KEY=`). Prune a persisted ref so the stale
      // SecretStorage value is no longer overlaid; un-create an in-pass ref.
      // The (now empty) line is kept as the user's explicit value.
      tracker.prune(key);
      out.push(line);
      continue;
    }

    // A re-entered key (already migrated, or a duplicate line in this pass)
    // updates the SAME secret in place — never a stale duplicate ref or a
    // plaintext line.
    const tracked = tracker.get(key);
    if (tracked) {
      setSecret(tracked.secretId, parsed[key]);
    } else {
      const id = uniquifySecretId(migratedEnvSecretId(scope, key), usedIds);
      usedIds.add(id);
      setSecret(id, parsed[key]);
      tracker.add({ scope, name: key, secretId: id });
    }
    // Drop the secret line from the sanitized blob (either way).
  }

  return { blob: out.join('\n'), refs: tracker.refs, clearedRefs: tracker.clearedRefs };
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

/** Mutable working state threaded through migrateEnvSecrets' extraction passes. */
interface EnvSecretMigration {
  settings: Record<string, unknown>;
  existing: SecretEnvVarRef[];
  storedIds: Set<string>;
  usedIds: Set<string>;
  setSecret: SecretSetter;
  newRefs: SecretEnvVarRef[];
  clearedRefs: SecretEnvVarRef[];
  changed: boolean;
}

function migrateScopedBlob(
  ctx: EnvSecretMigration,
  blob: string,
  scope: EnvironmentScope,
  forceWrite: boolean,
  write: (sanitized: string) => void,
): void {
  const result = extractBlobSecretRefs(blob, scope, ctx.setSecret, ctx.usedIds, ctx.existing);
  if (result.blob !== blob || forceWrite) {
    write(result.blob);
    if (result.blob !== blob) ctx.changed = true;
  }
  ctx.newRefs.push(...result.refs);
  ctx.clearedRefs.push(...result.clearedRefs);
}

// Saved snippets: migrate secret-shaped lines into a `snippet:<id>` scope so the
// value leaves the plaintext settings file. These refs stay inert at launch and
// are materialized on insert (see resolveSnippetEnvText).
function migrateSnippetBlobs(ctx: EnvSecretMigration): void {
  const snippets: Array<{ id?: unknown; envVars?: unknown }> = Array.isArray(ctx.settings.envSnippets)
    ? ctx.settings.envSnippets
    : [];
  for (const snippet of snippets) {
    if (!snippet || typeof snippet.id !== 'string' || typeof snippet.envVars !== 'string') {
      continue;
    }
    migrateScopedBlob(ctx, snippet.envVars, `snippet:${snippet.id}`, false, (sanitized) => {
      snippet.envVars = sanitized;
    });
  }
}

function storeProviderConfigSecret(
  ctx: EnvSecretMigration,
  scope: EnvironmentScope,
  envName: string,
  value: string,
): void {
  // A ref created in THIS run (from the env blob) already holds the live value;
  // the plaintext field is redundant — drop it without storing.
  const newRef = ctx.newRefs.find((ref) => ref.scope === scope && ref.name === envName);
  if (newRef) return;
  // A ref carried in settings — possibly synced from another device, whose
  // SecretStorage value is NOT present on this machine (secrets are device-local).
  const existingRef = ctx.existing.find((ref) => ref.scope === scope && ref.name === envName);
  if (existingRef) {
    // Don't clobber a value that IS present locally (that ref wins). But if the
    // referenced secret is absent on this device, the plaintext field is the only
    // local copy of the credential — recover it into the existing id rather than
    // deleting it into oblivion (which would launch with a missing key).
    if (!ctx.storedIds.has(existingRef.secretId)) {
      ctx.setSecret(existingRef.secretId, value);
      ctx.storedIds.add(existingRef.secretId);
    }
    return;
  }
  const id = uniquifySecretId(migratedEnvSecretId(scope, envName), ctx.usedIds);
  ctx.usedIds.add(id);
  ctx.setSecret(id, value);
  ctx.newRefs.push({ scope, name: envName, secretId: id });
}

// Provider-owned STRUCTURED secret fields (not env blobs): translate any
// plaintext value into a provider-scoped secret ref and strip the field, so the
// key leaves the settings file. Today this is only Codex's dead `apiKey` field;
// migrating it as OPENAI_API_KEY also makes it take effect.
function migrateProviderConfigSecretFields(ctx: EnvSecretMigration): void {
  const providerConfigs = ctx.settings.providerConfigs as Record<string, Record<string, unknown>> | undefined;
  if (!providerConfigs) return;
  for (const { providerId, field, envName } of PROVIDER_CONFIG_SECRET_FIELDS) {
    const config = providerConfigs[providerId];
    const value = config?.[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    storeProviderConfigSecret(ctx, `provider:${providerId}`, envName, value);
    delete config[field];
    ctx.changed = true;
  }
}

function applyMigratedRefChanges(ctx: EnvSecretMigration): void {
  if (ctx.newRefs.length === 0 && ctx.clearedRefs.length === 0) return;
  // Prune only the SPECIFIC cleared refs (by identity) — the UI lets multiple
  // rows/scopes point at the same SecretStorage entry, so clearing by id alone
  // would drop unrelated refs. Clear a stored value only when no remaining ref
  // still references that id.
  const cleared = new Set(ctx.clearedRefs);
  const next = [...ctx.existing.filter((ref) => !cleared.has(ref)), ...ctx.newRefs];
  ctx.settings.secretEnvVars = next;
  const stillUsed = new Set(next.map((ref) => ref.secretId));
  for (const ref of ctx.clearedRefs) {
    // Mirror the settings UI's clearIfOrphaned guard: SecretStorage ids are
    // global across plugins and a ref may point at a user-selected external id
    // (via SecretComponent), so only auto-erase Specorator-owned ids — never a
    // secret another plugin owns.
    if (!isSpecoratorGeneratedSecretId(ref.secretId)) continue;
    if (!stillUsed.has(ref.secretId)) ctx.setSecret(ref.secretId, '');
  }
  ctx.changed = true;
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
  const storedIds = new Set<string>(store.list());
  const ctx: EnvSecretMigration = {
    settings,
    existing,
    storedIds,
    usedIds: new Set<string>([...existing.map((ref) => ref.secretId), ...storedIds]),
    setSecret: (id, value) => store.set(id, value),
    newRefs: [],
    clearedRefs: [],
    changed: false,
  };

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

  // Write shared back when it changed, or to materialize the legacy blob's shared
  // portion before the legacy field is removed.
  migrateScopedBlob(ctx, sharedBlob, 'shared', hadLegacy, (sanitized) => {
    setSharedEnvironmentVariables(settings, sanitized);
  });

  for (const providerId of providerIds) {
    const blob = providerBlobs.get(providerId) ?? '';
    // Write back when changed, or to materialize this provider's legacy lines.
    migrateScopedBlob(ctx, blob, `provider:${providerId}`, hadLegacy && blob.length > 0, (sanitized) => {
      setProviderEnvironmentVariables(settings, providerId, sanitized);
    });
  }

  migrateSnippetBlobs(ctx);

  if (hadLegacy) ctx.changed = true; // the legacy field was removed → settings changed

  migrateProviderConfigSecretFields(ctx);
  applyMigratedRefChanges(ctx);
  return ctx.changed;
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
