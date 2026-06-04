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
): { blob: string; refs: SecretEnvVarRef[] } {
  const refs: SecretEnvVarRef[] = [];
  const out: string[] = [];

  for (const line of blob.split(/\r?\n/)) {
    if (PLAINTEXT_OPT_OUT.test(line)) {
      out.push(line);
      continue;
    }
    // A single line yields at most one key via the canonical parser.
    const parsed = parseEnvironmentVariables(line);
    const key = Object.keys(parsed)[0];
    if (!key || !isSecretEnvKey(key) || parsed[key] === '') {
      out.push(line);
      continue;
    }

    const id = uniquifySecretId(migratedEnvSecretId(scope, key), usedIds);
    usedIds.add(id);
    setSecret(id, parsed[key]);
    refs.push({ scope, name: key, secretId: id });
    // Drop the secret line from the sanitized blob.
  }

  return { blob: out.join('\n'), refs };
}
