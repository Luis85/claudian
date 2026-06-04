/**
 * SECURITY (SEC-A): keychain-backed storage for secret values.
 *
 * Provider API keys and MCP auth headers must not persist in cleartext inside
 * the syncable/committable vault files (`.claudian/claudian-settings.json`,
 * `.claude/mcp.json`). This wraps Obsidian's `SecretStorage` (Electron
 * `safeStorage`-backed, OS keychain, out-of-vault), which is available since
 * Obsidian 1.11.4 — the plugin's `minAppVersion`. There is intentionally no
 * fallback: callers can assume `app.secretStorage` exists.
 *
 * The vault files store only references (see `secretRefs.ts`); this store holds
 * the real values. Note the Obsidian API exposes no delete — overwriting a
 * value is the only mutation; orphaned ids are harmless and inert.
 */

/** The subset of Obsidian's `SecretStorage` we depend on (injectable for tests). */
export interface SecretStorageApi {
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
  listSecrets(): string[];
}

export class SecretStore {
  constructor(private readonly api: SecretStorageApi) {}

  /** Store (or overwrite) a secret value under a pre-validated id. */
  set(id: string, value: string): void {
    this.api.setSecret(id, value);
  }

  /** Read a secret value, or `null` if absent. */
  get(id: string): string | null {
    return this.api.getSecret(id);
  }

  /** Whether a secret value is stored for the id. */
  has(id: string): boolean {
    return this.api.getSecret(id) !== null;
  }

  /** All stored secret ids. */
  list(): string[] {
    return this.api.listSecrets();
  }
}
