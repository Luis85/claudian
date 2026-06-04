---
status: ready-for-execution
parent: Security
issue: "[[docs/issues/adopt-secretstorage-for-secrets.md]]"
created: 2026-06-03
scope: SEC-A — provider secrets + MCP auth headers at rest
---

# Implementation Package — Adopt Obsidian SecretStorage for secrets at rest (SEC-A)

> Scoped, ready-to-execute package for the single highest-value security item. Source issue:
> [[docs/issues/adopt-secretstorage-for-secrets.md]]. One concern; phased so each phase ships green.

## Goal

Stop persisting provider API keys, MCP auth headers, and secret-shaped env values **in cleartext**
inside the in-vault, syncable/committable files (`.claudian/claudian-settings.json`, `.claude/mcp.json`).
Move secret **values** into Obsidian's keychain-backed `SecretStorage`, leaving only **references** in the
vault files, and resolve those references at the moments the real value is needed (CLI child env, live MCP
spawn, and the in-app MCP Test transport).

## Non-goals (explicitly out of scope)

- Broad log/diagnostics value-level redaction (that is SEC-E / `value-level-diagnostics-redaction` — only
  the "secrets never leak via our own exports" *assertion test* is in scope here).
- Remote-MCP SSRF hardening (SEC-D), Codex env allowlist (SEC-C), Opencode path containment (SEC-B).
- Any provider behavior change beyond where a secret value is sourced from.

## Background — the secret surface (verified against the tree)

Secrets are **not discrete fields**; they live inside free-text/structured config:

| Surface | Where | File on disk | Evidence |
|---|---|---|---|
| Shared env blob | `settings.sharedEnvironmentVariables: string` (`KEY=VALUE\n…`) | `.claudian/claudian-settings.json` | `core/types/settings.ts:135`; `defaultSettings.ts:27`; cleartext note `providerEnvironment.ts:180-185` |
| Per-snippet env blobs | `settings.envSnippets[].envVars: string` | `.claudian/claudian-settings.json` | `core/types/settings.ts:20-27` |
| MCP remote auth headers | `McpSSEServerConfig.headers` / `McpHttpServerConfig.headers` | `.claude/mcp.json` | `core/types/mcp.ts:15,22`; `McpStorage.ts:9` (`MCP_CONFIG_PATH`) |
| MCP stdio env | `McpStdioServerConfig.env` | `.claude/mcp.json` | `core/types/mcp.ts` (stdio `env?`) |
| In-app MCP Test | `McpTester` builds the transport with `config.headers` (`requestInit`) in the **plugin process** | n/a (runtime) | `McpTester.ts` header/`requestInit` handling |

API keys are entered as env lines in the provider tabs' Environment textareas (e.g.
`ANTHROPIC_API_KEY=…` `ClaudeSettingsTab.ts:399`, `OPENAI_API_KEY=…` `CodexSettingsTab.ts:443`).

### SecretStorage API (installed `obsidian` types, since 1.11.4)

Synchronous: `app.secretStorage.setSecret(id, secret)`, `getSecret(id): string | null`,
`listSecrets(): string[]`. **IDs are lowercase alphanumeric with optional dashes** (`obsidian.d.ts:5463-5491`).
A `SecretComponent` settings widget exists (`setValue`/`onChange`, `:5441`). `manifest.minAppVersion` is
currently **`1.7.2`**.

## Key design decisions

1. **DECIDED (2026-06-03) — bump `minAppVersion` to `1.11.4`; no backwards compatibility.** `SecretStorage`
   requires Obsidian ≥1.11.4, so `manifest.json` `minAppVersion` is bumped to `1.11.4` and there is **no
   feature-detect fallback** — `SecretStore` assumes `app.secretStorage` exists. Sub-1.11.4 users are
   intentionally dropped (cleaner, no plaintext-fallback branch to maintain). The disclosure stopgap is
   therefore unnecessary.

2. **Reference token format.** Vault files store a reference, never a value:
   - `.claudian/claudian-settings.json` env blobs: a Claudian-owned token `${secret:<id>}` on the value side
     of a `KEY=VALUE` line (e.g. `ANTHROPIC_API_KEY=${secret:env-shared-anthropic-api-key}`). Claudian
     resolves it when building the child env and the in-app transport.
   - `.claude/mcp.json`: use Claude Code's **own** documented expansion `${VAR}` / `${VAR:-default}` (the
     Claude CLI reads this file and expands from the *process env*), and have Claudian **inject `VAR` into the
     spawned CLI's env** from SecretStorage at launch. For the in-app `McpTester` (plugin process, not the
     CLI), Claudian resolves the same refs before constructing the transport. **Do not** write `${secret:…}`
     into `.claude/mcp.json` — the CLI wouldn't understand it.

3. **What counts as a secret.** Env keys matching `/(_|^)(API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH|KEY)$/i`
   (plus an explicit allowlist for known providers: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
   `OPENAI_API_KEY`, etc.), and **always** MCP `headers.Authorization` / `*-Api-Key` style headers.
   Non-secret env (`*_BASE_URL`, `*_MODEL`, sandbox flags) stays inline. Provide a per-line opt-out comment
   (e.g. `# claudian:plaintext`) for power users.

4. **Stable secret IDs.** Derive deterministically from scope + key, dash-cased to satisfy the ID rule:
   `env-shared-<key>`, `env-snippet-<snippetId>-<key>`, `mcp-<serverName>-header-<headerName>`,
   `mcp-<serverName>-env-<key>` (all lowercased, non-`[a-z0-9-]` → `-`). Collisions resolved by suffix.

## Architecture

- **`src/core/security/secretStore.ts`** — thin wrapper over `app.secretStorage` with feature-detect +
  fallback; the only module that touches the Obsidian API. `get/set/list/has/delete`, `isBacked(): boolean`.
- **`src/core/security/secretRefs.ts`** — **pure** (no I/O): token format, ID derivation, `extractSecrets()`
  (config-in → {sanitized-config, [{id,value}]}), `resolveRefs()` (sanitized-config + getter → resolved),
  secret-key detection. Fully unit-tested in isolation.
- **Integration points (resolve refs → real values):** the env builder (`providerEnvironment.ts` /
  `utils/env.ts`), the live MCP spawn (`McpServerManager.getActiveServers` / connect), and `McpTester`
  transport construction. **Save points (extract → store + write refs):** settings save
  (`ClaudianSettingsStorage`) and MCP save (`McpStorage.save`).

## Phased task breakdown

### Phase 0 — `SecretStore` wrapper + manifest bump (S)
- [ ] Bump `manifest.json` `minAppVersion` to `1.11.4`.
- [ ] Add `src/core/security/secretStore.ts`: thin typed wrapper over `app.secretStorage`
      (`get`/`set`/`has`/`delete`/`list`). **Backed-only — no fallback** (relies on the bumped minAppVersion).
- [ ] Unit tests with a mocked `app.secretStorage`.
- [ ] `typecheck && lint && test && build` green.

### Phase 1 — pure `secretRefs` core (M)
- [ ] Add `src/core/security/secretRefs.ts`: token grammar `${secret:<id>}`, ID derivation, secret-key
      detection, `extractSecretsFromEnvBlob()`, `resolveEnvBlob()`, `extractSecretsFromMcpConfig()`,
      `resolveMcpConfig()`. Pure functions, no Obsidian import.
- [ ] Golden unit tests: env blob with mixed secret/non-secret lines; opt-out comment; MCP headers + stdio
      env; idempotent re-extract; round-trip extract→resolve equals original.

### Phase 2 — env-var secrets (M)
- [ ] On settings save (`ClaudianSettingsStorage`), run `extractSecretsFromEnvBlob` over
      `sharedEnvironmentVariables` + each `envSnippets[].envVars`; store values via `SecretStore`; persist refs.
- [ ] On env application (`providerEnvironment`/`utils/env`), resolve refs before building the curated child env.
- [ ] **Migration on load:** detect plaintext secret values in existing blobs and migrate them to refs once
      (write-back), guarded so it runs only when `SecretStore.isBacked()`.
- [ ] Tests: keys absent from persisted settings JSON; child env still receives real values; migration is
      idempotent; unbacked fallback leaves today's behavior + warning.

### Phase 3 — MCP header / stdio-env secrets (M)
- [ ] On `McpStorage.save`, extract `headers`/`env` secrets; store via `SecretStore`; write `${VAR}` refs into
      `.claude/mcp.json` and record the id↔VAR mapping.
- [ ] Resolve at **live spawn** (`McpServerManager`): inject resolved `VAR`s into the curated child env so the
      Claude CLI's `${VAR}` expansion succeeds.
- [ ] Resolve at the **in-app `McpTester`** transport: replace `config.headers` refs with real values before
      building `requestInit` (plugin-process path — does not go through the CLI).
- [ ] Tests: `.claude/mcp.json` carries no plaintext header/token; both the live path and the Test button send
      real auth; round-trip.

### Phase 4 — settings UX + leak-assertion + docs (S–M)
- [ ] Provider Environment textareas: render saved secret lines as masked refs; entering a new secret value
      re-extracts on save. (Optionally use `SecretComponent` for a dedicated "API key" field per provider.)
- [ ] One-time migration notice (informational; secrets moved into the OS keychain).
- [ ] Assertion test: diagnostics/transcripts/log export never contain a stored secret value (ties to but
      does not implement SEC-E).
- [ ] Update `README.md` Privacy section + `docs/product/user-manuals/settings.md` to describe SecretStorage
      and the `minAppVersion: 1.11.4` requirement; note the bump in release notes.

## Test plan

- Unit: `secretRefs` (pure, exhaustive), `secretStore` (backed + fallback).
- Integration: settings save/load round-trip moves secrets out of the JSON and restores child env; MCP
  save/spawn/test round-trip; migration idempotency.
- Negative/assertion: persisted `.claudian/claudian-settings.json` and `.claude/mcp.json` contain **no**
  known secret value after save; diagnostics export contains none.
- `npm run typecheck && npm run lint && npm run test && npm run build` green per phase.

## Risks & mitigations

- **Data loss / lockout if `SecretStorage` clears** (e.g. keychain reset, different machine syncing the vault
  but not the keychain): refs would dangle. Mitigation: on unresolved ref, surface a clear "re-enter secret"
  state, never crash; keep migration one-way only when backed; document that secrets are device-local.
- **Sync across machines:** SecretStorage is device-local; a synced vault on a new machine has refs but no
  values → prompt to re-enter. Document this as expected (it's the security trade-off).
- **CLI `${VAR}` expansion assumptions:** verify Claude CLI expands `${VAR}` in `.claude/mcp.json` headers in
  a smoke test before relying on it; otherwise resolve fully and inject via env only.
- **Rollback:** each phase is independent and behind `SecretStore.isBacked()`; reverting a phase leaves prior
  phases working.

## Definition of done

- New writes: no provider API key, MCP auth header, or secret-shaped env value persists in plaintext in
  `.claudian/claudian-settings.json` or `.claude/mcp.json` when `SecretStorage` is available.
- Real values still reach: the provider CLI child env, the live MCP spawn, and the in-app MCP Test transport.
- Existing plaintext secrets migrate once, idempotently, when backed.
- Compatibility path (per decision) verified on a sub-1.11.4 install (feature-detect fallback + warning) or
  via the `minAppVersion` bump.
- All gates green; a test asserts no secret value appears in persisted files or diagnostics export.

## Decision (settled 2026-06-03)

**Bump `minAppVersion` to `1.11.4`; no backwards compatibility / no fallback.** `SecretStore` is
backed-only; Phase 4 sets the manifest and drops all fallback/disclosure-stopgap handling.
