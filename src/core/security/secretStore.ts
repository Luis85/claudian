/**
 * SECURITY (SEC-A): keychain-backed storage for secret values.
 *
 * Provider API keys and MCP auth headers must not persist in cleartext inside
 * the syncable/committable vault files (`.claudian/claudian-settings.json`,
 * `.claude/mcp.json`). This wraps Obsidian's `SecretStorage`, which encrypts
 * secrets at rest via the OS keychain (Electron `safeStorage`) since Obsidian
 * 1.11.5 — the plugin's `minAppVersion`. (1.11.4 introduced the API but stored
 * values in plaintext localStorage, so 1.11.5 is the real floor.) There is
 * intentionally no fallback: callers can assume `app.secretStorage` exists.
 *
 * Threat model is honest: this keeps secrets out of synced/committed files and
 * (with a real keyring) out of other OS users' reach — it does NOT isolate from
 * same-user processes or other plugins (the id space is global). Our files store
 * only the secret id/name (see `secretIds.ts`); this store holds the values.
 *
 * The Obsidian API exposes no delete — `clear()` overwrites with an empty string,
 * the in-the-wild convention; orphaned ids are otherwise harmless and inert.
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

  /**
   * Whether a usable secret value is stored. Both `null` (never set / absent on
   * this device) and `''` (cleared — the API has no delete, so `clear()` writes
   * an empty string) count as absent, so callers don't mistake a cleared secret
   * for a present one and skip re-entry.
   */
  has(id: string): boolean {
    const value = this.api.getSecret(id);
    return value !== null && value !== '';
  }

  /** All stored secret ids. */
  list(): string[] {
    return this.api.listSecrets();
  }

  /** Clear a secret (the API has no delete; overwriting with '' is the convention). */
  clear(id: string): void {
    this.api.setSecret(id, '');
  }
}
