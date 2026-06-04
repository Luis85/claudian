---
status: in-progress
parent: Security
issue: "[[docs/issues/adopt-secretstorage-for-secrets.md]]"
research: "[[docs/research/2026-06-04-obsidian-secret-storage.md]]"
created: 2026-06-03
updated: 2026-06-04
scope: SEC-A — provider secrets + MCP auth headers at rest
---

# Implementation Package — Adopt Obsidian SecretStorage for secrets at rest (SEC-A)

> Phased, ready-to-execute package. Revised 2026-06-04 after web research into Obsidian's Secrets feature
> (see the research note). The detection-heuristic/blob-rewriting approach was dropped in favour of the
> idiomatic **structured `SecretComponent`** design.

## Goal

Stop persisting provider API keys and MCP auth headers in the **syncable/committable vault files**
(`.claudian/claudian-settings.json`, `.claude/mcp.json`). Store secret **values** in Obsidian's
keychain-backed `SecretStorage`; persist only the secret's **name/id** in our files; resolve the value at
the moments it is needed (child env, live MCP spawn, in-app MCP Test).

## Honest threat model (what SEC-A does / does not buy)

Per research: Obsidian `SecretStorage` (≥1.11.5) keeps secrets **out of synced/committed files** and (with a
real OS keyring) protects against **other OS users**. It does **NOT** isolate from same-user processes or
other plugins — the id space is **global and shared across plugins** — and on Linux without a keyring it
degrades to obfuscation. So SEC-A's defensible claim is *"secrets no longer live in the vault files,"* not
*"hardened against local attackers."* The plan/docs must say this plainly.

## Non-goals

- Value-level log/diagnostics redaction (SEC-E — only the "secrets never leak via our exports" assertion test).
- SEC-B/C/D. Any provider behavior change beyond where a secret value is sourced from.

## Background — the secret surface (verified against the tree)

| Surface | Where | File on disk |
|---|---|---|
| Shared env blob | `settings.sharedEnvironmentVariables: string` (`KEY=VALUE\n…`) | `.claudian/claudian-settings.json` |
| Per-snippet env blobs | `settings.envSnippets[].envVars: string` | `.claudian/claudian-settings.json` |
| MCP remote auth headers | `McpSSEServerConfig.headers` / `McpHttpServerConfig.headers` | `.claude/mcp.json` |
| MCP stdio env | `McpStdioServerConfig.env` | `.claude/mcp.json` |
| In-app MCP Test | `McpTester` builds the transport with `config.headers` in the plugin process | runtime |

API keys are entered today as env lines in the provider tabs (`ANTHROPIC_API_KEY=…`, `OPENAI_API_KEY=…`).

## Obsidian Secrets — research-grounded facts (full detail in the research note)

- **`minAppVersion` must be `1.11.5`** — 1.11.4 stored secrets in **plaintext localStorage**; encryption at
  rest landed in **1.11.5**.
- API (`obsidian.d.ts`): synchronous `app.secretStorage.{setSecret(id,v):void, getSecret(id):string|null,
  listSecrets():string[]}`. **No delete** → clear via `setSecret(id, '')`. `id` = lowercase alphanumeric +
  dashes, throws if invalid.
- `SecretComponent(app, containerEl)` with `setValue(id)`/`onChange(id)` (no `getValue`); attach via
  `Setting.addComponent(...)`. It manages a **named** secret; we persist the **name/id**, not the value.
- Secrets are **device-local, do not sync**; on a new device `getSecret` returns `null` → prompt to re-enter.

## Key design decisions

1. **`minAppVersion` → `1.11.5`; no backwards-compat fallback** (corrects the earlier 1.11.4 bump).
2. **Structured, `SecretComponent`-driven** (not heuristic blob rewriting): dedicated per-provider API-key
   field(s) rendered with `SecretComponent`; settings store the secret **id/name**; the env blob carries only
   non-secret config; at env-build we `getSecret(id)` and inject under the canonical var name (e.g.
   `ANTHROPIC_API_KEY`). Reuse the existing `parseEnvironmentVariables()` for the non-secret blob.
3. **Namespaced ids for anything Claudian creates** (`claudian-…`) to avoid clobbering in the global space —
   but `SecretComponent` lets a user point at an existing shared secret, in which case we store their chosen id.
4. **Detection is migration-only and advisory.** The suffix/allowlist matcher is used solely to *suggest*
   existing plaintext secrets for the user to confirm-migrate — never to silently classify in steady state.
5. **Delete = `setSecret(id, '')`** (no native delete).

## Architecture

- **`src/core/security/secretStore.ts`** — backed-only wrapper over `app.secretStorage`
  (`get`/`set`/`has`/`list`/`clear`). The only module touching the Obsidian API.
- **`src/core/security/secretIds.ts`** — **pure** (no I/O): `normalizeSecretId`, namespaced id derivation for
  migrated values, `uniquifySecretId` (collision-proof), and migration-only `isSecretEnvKey`/`isSecretHeaderName`.
  (Replaces the dropped `secretRefs.ts` token machinery.)
- **Integration:** SecretComponent fields in provider settings tabs; `getSecret` at the child-env builder
  (`providerEnvironment`/`utils/env`), live MCP spawn (`McpServerManager`), and the in-app `McpTester`; a
  one-time migration in `ClaudianSettingsStorage.load` / MCP load.

## Phased task breakdown

### Phase 0 — `SecretStore` + manifest (revised) — *foundation, in PR #27*
- [x] `manifest.json` `minAppVersion` → **1.11.5** (corrected from 1.11.4).
- [x] `SecretStore` wrapper (`get`/`set`/`has`/`list`) — **add `clear(id) = setSecret(id, '')`**.
- [x] Unit tests with a mocked `app.secretStorage`.

### Phase 1 — pure `secretIds` core (revised) — *foundation, in PR #27*
- [x] Replace `secretRefs.ts` with `secretIds.ts`: `normalizeSecretId`, `claudianMigratedSecretId(scope,key)`
      (namespaced), `uniquifySecretId`, migration-only `isSecretEnvKey`/`isSecretHeaderName`.
- [x] Remove the `${secret:…}` token, `extractEnvBlobSecrets`/`resolveEnvBlob`, and steady-state detection.
- [x] Golden unit tests for id derivation, namespacing, collisions, and migration detection (incl. `AUTH`).

### Phase 2 — provider API keys via SecretComponent (M)
- [ ] Add per-provider `secretId` settings fields (Claude/Codex/…); render with `SecretComponent` via
      `Setting.addComponent`; persist the id only.
- [ ] At env build, `getSecret(id)` and inject under the canonical var name; non-secret blob via
      `parseEnvironmentVariables()`. `null` ⇒ surface "re-enter on this device".
- [ ] One-time migration: detect plaintext secret lines in existing blobs (advisory) →
      `setSecret(derivedId, value)` → repoint → clear from blob → save. Idempotent, only when SecretStorage present.
- [ ] Tests: no key in persisted settings JSON; child env still receives the value; migration idempotent.

### Phase 3 — MCP header / stdio-env secrets (M)
- [ ] SecretComponent for MCP auth header value in the server editor; persist id in `_claudian` metadata.
- [ ] Resolve at live spawn (`McpServerManager`) and the in-app `McpTester`. **Open sub-decision:** whether
      the Claude CLI expands `${VAR}` in `.claude/mcp.json` — safe default is resolve-fully-in-plugin + a smoke test.
- [ ] Tests: no plaintext header/token in `.claude/mcp.json`; live + Test paths send real auth.

### Phase 4 — UX, leak-assertion, docs (S–M) — shipped
- [x] `SecretComponent` UI (`SecretEnvVarsSection`) to add/edit/remove provider keys per scope, with a
      "not set on this device" indicator; wired below the env textarea. Migration notice via `env.secretMissing`.
- [x] Assertion test: persisted settings JSON contains the secret ids but never the secret values.
- [ ] `README.md` Privacy + `docs/product/user-manuals/settings.md`: SecretStorage, the **honest threat model**,
      `minAppVersion 1.11.5`, Linux keyring requirement, device-local re-entry.

## Test plan
Unit: `secretIds` (pure), `secretStore` (mocked API incl. `clear`). Integration: settings save/load round-trip
moves keys out of JSON and restores child env; MCP round-trip; migration idempotency. Negative: persisted files
+ diagnostics contain no known secret value. Gates green per phase.

## Risks & mitigations
- **Device-local / no sync:** new machine has the id but no value → documented re-entry prompt, never crash.
- **Linux no-keyring deg: ** obfuscation only — documented; not relied on as a hard boundary.
- **Global namespace / other plugins can read:** documented; namespaced ids avoid collisions.
- **CLI `${VAR}` expansion (MCP):** verify with a smoke test before relying on env injection; else resolve fully.
- **Rollback:** phases independent; migration one-way and guarded.

## Definition of done
New writes: no provider key or MCP auth header in `.claudian/claudian-settings.json` / `.claude/mcp.json`.
Values still reach child env, live MCP spawn, and in-app Test. Existing plaintext migrates once, idempotently.
`minAppVersion 1.11.5`. Honest threat model documented. Gates green; leak-assertion test passes.

## Decisions log
- 2026-06-03: bump minAppVersion, no fallback.
- 2026-06-04: **structured `SecretComponent` design** over heuristic blob rewriting; **minAppVersion 1.11.5**
  (1.11.4 was plaintext); honest threat-model framing — all driven by the research note.
