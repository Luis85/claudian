/**
 * SEC-A Phase 3: pure helpers for MCP auth-header / stdio-env secrets. No I/O.
 *
 * Steady state: the secret VALUE lives in Obsidian SecretStorage; the server's
 * `_claudian` metadata holds only `secretHeaders` / `secretEnv` (name → secret id).
 * At launch (`McpServerManager.getActiveServers`) and in-app verification
 * (`McpTester`) the values are OVERLAID onto the config in-plugin — they never
 * persist in the committable/syncable `.claude/mcp.json`.
 *
 * Migration (one-time): EXTRACT secret-shaped plaintext header/env values out of
 * an existing config into the store and record the refs.
 */
import {
  isSecretEnvKey,
  isSecretHeaderName,
  migratedMcpEnvSecretId,
  migratedMcpHeaderSecretId,
  uniquifySecretId,
} from '../security/secretIds';
import type {
  ManagedMcpServer,
  McpHttpServerConfig,
  McpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../types/mcp';
import { getMcpServerType } from '../types/mcp';

export type McpSecretResolver = (id: string) => string | null;

/**
 * Masked sentinel shown in the MCP editor for an existing secret header/env value
 * (the real value is never surfaced). Leaving it unchanged keeps the ref; deleting
 * the line or emptying it removes the credential.
 */
export const MCP_SECRET_PLACEHOLDER = '••••••';

/**
 * SEC-A Phase 3: reconcile an edited header/env map (parsed from the editor
 * textarea) against the server's existing secret refs. Returns the plaintext
 * entries to persist and the secret refs to keep:
 * - unchanged placeholder → keep the ref (no plaintext written);
 * - a real value → plaintext; if it re-enters an existing ref's key, keep that id
 *   so migration updates the same secret in place instead of orphaning it;
 * - an omitted key or an emptied one (`KEY=`) → drop the ref (so resolution stops
 *   overlaying a credential the user removed).
 */
export function reconcileEditedMcpSecrets(
  parsed: Record<string, string>,
  existingRefs: Record<string, string> | undefined,
): { plaintext: Record<string, string>; refs: Record<string, string> } {
  const existing = existingRefs ?? {};
  const plaintext: Record<string, string> = {};
  const refs: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (existing[key] && value === MCP_SECRET_PLACEHOLDER) {
      refs[key] = existing[key];
    } else if (value === '') {
      // cleared → drop the ref and write no plaintext
    } else {
      plaintext[key] = value;
      if (existing[key]) refs[key] = existing[key]; // re-entry reuses the id
    }
  }
  return { plaintext, refs };
}

/** Minimal SecretStorage surface needed to migrate values out of configs. */
export interface McpSecretStore {
  set(id: string, value: string): void;
  list(): string[];
}

interface ExtractRecordResult {
  refs: Record<string, string>;
  changed: boolean;
}

/**
 * Move secret-shaped, non-empty entries of `record` into the store (mutating
 * `record` to drop them) and return the merged name → id refs. Reuses an existing
 * ref's id when the same key is re-entered, so a rotated value updates in place
 * instead of orphaning a duplicate id.
 */
function extractRecordSecrets(
  record: Record<string, string> | undefined,
  isSecret: (key: string) => boolean,
  deriveId: (key: string) => string,
  store: McpSecretStore,
  usedIds: Set<string>,
  existingRefs: Record<string, string> | undefined,
): ExtractRecordResult {
  const refs: Record<string, string> = { ...(existingRefs ?? {}) };
  let changed = false;
  if (!record) return { refs, changed };

  for (const key of Object.keys(record)) {
    if (!isSecret(key)) continue;
    const value = record[key];
    if (!value) continue; // empty value: nothing to protect, leave as-is

    const id = refs[key] ?? uniquifySecretId(deriveId(key), usedIds);
    if (!refs[key]) usedIds.add(id);
    store.set(id, value);
    refs[key] = id;
    delete record[key];
    changed = true;
  }

  return { refs, changed };
}

/**
 * SEC-A Phase 3: move secret-shaped plaintext header/env values out of every MCP
 * server config into SecretStorage. Mutates each server (records
 * `secretHeaders` / `secretEnv`, strips the plaintext from `config`). Idempotent:
 * a config with no plaintext secrets is left untouched. Returns whether anything
 * changed.
 */
export function extractMcpServerSecrets(servers: ManagedMcpServer[], store: McpSecretStore): boolean {
  // Seed used ids from the store and from refs already recorded, so a derived id
  // never clobbers an unrelated secret (the id space is global within the vault).
  const usedIds = new Set<string>(store.list());
  for (const server of servers) {
    for (const id of Object.values(server.secretHeaders ?? {})) usedIds.add(id);
    for (const id of Object.values(server.secretEnv ?? {})) usedIds.add(id);
  }

  let changed = false;
  for (const server of servers) {
    if (getMcpServerType(server.config) === 'stdio') {
      const stdio = server.config as McpStdioServerConfig;
      const result = extractRecordSecrets(
        stdio.env,
        isSecretEnvKey,
        (key) => migratedMcpEnvSecretId(server.name, key),
        store,
        usedIds,
        server.secretEnv,
      );
      if (result.changed) {
        server.secretEnv = result.refs;
        if (stdio.env && Object.keys(stdio.env).length === 0) delete stdio.env;
        changed = true;
      }
    } else {
      const url = server.config as McpSSEServerConfig | McpHttpServerConfig;
      const result = extractRecordSecrets(
        url.headers,
        isSecretHeaderName,
        (key) => migratedMcpHeaderSecretId(server.name, key),
        store,
        usedIds,
        server.secretHeaders,
      );
      if (result.changed) {
        server.secretHeaders = result.refs;
        if (url.headers && Object.keys(url.headers).length === 0) delete url.headers;
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * SEC-A Phase 3: return a config with secret header/env values overlaid from
 * SecretStorage (non-mutating). A secret absent on this device is omitted, never
 * injected empty — the server launches/tests without it rather than with a blank
 * credential.
 */
export function resolveMcpServerConfig(
  server: ManagedMcpServer,
  resolve: McpSecretResolver,
): McpServerConfig {
  if (getMcpServerType(server.config) === 'stdio') {
    const refs = server.secretEnv;
    if (!refs || Object.keys(refs).length === 0) return server.config;
    const stdio = server.config as McpStdioServerConfig;
    const env = { ...(stdio.env ?? {}) };
    overlayResolved(env, refs, resolve);
    return { ...stdio, env };
  }

  const refs = server.secretHeaders;
  if (!refs || Object.keys(refs).length === 0) return server.config;
  const url = server.config as McpSSEServerConfig | McpHttpServerConfig;
  const headers = { ...(url.headers ?? {}) };
  overlayResolved(headers, refs, resolve);
  return { ...url, headers };
}

function overlayResolved(
  target: Record<string, string>,
  refs: Record<string, string>,
  resolve: McpSecretResolver,
): void {
  for (const [name, id] of Object.entries(refs)) {
    const value = resolve(id);
    if (value !== null && value !== '') target[name] = value;
  }
}
