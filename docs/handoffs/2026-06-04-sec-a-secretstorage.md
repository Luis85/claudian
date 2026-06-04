---
title: SEC-A SecretStorage — handoff for remaining work
date: 2026-06-04
status: phases-0-4-shipped; phase-3-mcp + snippet-scope + i18n complete
scope: SEC-A (provider secrets + env vars out of plaintext into Obsidian SecretStorage)
pr: "Luis85/claudian#27 (branch claude/secretstorage-secrets)"
related:
  - "[[docs/superpowers/plans/2026-06-03-secretstorage-secrets.md]]"
  - "[[docs/research/2026-06-04-obsidian-secret-storage.md]]"
  - "[[docs/issues/adopt-secretstorage-for-secrets.md]]"
---

# SEC-A SecretStorage — handoff

Provider API keys / tokens now live in Obsidian's keychain-backed **SecretStorage** (OS keychain,
out-of-vault), not in plaintext vault files. PR #27 (branch `claude/secretstorage-secrets`, HEAD
`ae643cc`) is **complete and mergeable** for Phases 0–2 + 4; Phase 3 (MCP) and a couple of follow-ups
remain. All 21 Codex review threads on the PR are resolved.

## What shipped (Phases 0–2 + 4)

- **Foundation** — `src/core/security/secretStore.ts` (backed-only wrapper over `app.secretStorage`:
  `get`/`set`/`has`/`list`/`clear`; `get`/`has` treat cleared/empty `''` as absent; no native delete →
  `clear` writes `''`) and `src/core/security/secretIds.ts` (pure: `normalizeSecretId`, namespaced
  `claudian-…` migration id derivation, `uniquifySecretId`, migration-only `isSecretEnvKey`/`isSecretHeaderName`).
- **Structured model** — `SecretEnvVarRef { scope, name, secretId }` + `settings.secretEnvVars`
  (`src/core/types/settings.ts`); only the secret **id/name** is persisted, never the value.
- **Helpers** — `src/core/providers/secretEnvVars.ts`: `overlaySecretEnvVars`, `resolveProviderEnvVars`
  (precedence: shared plaintext < shared secret < provider plaintext < provider secret), `extractBlobSecretRefs`,
  `migrateEnvSecrets` (one-time migration of secret-shaped plaintext env lines, snapshot-before-mutate so
  legacy `environmentVariables` upgrades don't lose provider lines).
- **Resolution at launch** — `main.ts` `getResolvedEnvironmentVariables(providerId)` overlays secrets;
  **every** child-process spawn path uses it: Claude (chat ×2, cold-start, title, probe), Codex app-server,
  Cursor agent, Opencode (`buildOpencodeRuntimeEnv` + chat/aux launch keys).
- **Env-hash stability** — `EnvTextResolver` returns `{ text, missingKeys }`; `reconcileEnvironmentHash`
  hashes the resolved env (so plaintext→keychain move doesn't invalidate sessions) and **defers**
  invalidation only when a *watched* secret is missing on this device (synced-vault safety).
- **Migration on edit + clear** — `EnvironmentApplyService.applyBatch` runs `migrateEnvSecrets` after env
  edits; re-entering a key reuses its ref; clearing (`KEY=`) prunes the specific ref and clears the value
  only if unreferenced.
- **Phase 4 UI** — `src/features/settings/ui/SecretEnvVarsSection.ts` (`SecretComponent` rows per scope:
  add/edit/remove, "not set on this device" indicator), wired into `EnvironmentSettingsSection`. Persist
  routes through `EnvironmentApplyService.applySecretEnvVars` (full reconcile/tab-sync). Missing-secret
  `Notice` (`env.secretMissing`, 10 locales). Leak-assertion test (settings JSON never contains a value).
- **Release** — `manifest.json`/`package.json` → `3.3.0`, `minAppVersion 1.11.5` (1.11.4 stored plaintext;
  encryption-at-rest landed in 1.11.5), `versions.json` gated `"3.3.0": "1.11.5"`.

## Honest threat model (documented in README + settings.md)

Keeps secrets out of synced/committed vault files and (with a real OS keyring) out of other OS users'
reach. Does **NOT** isolate from same-user processes or other Obsidian plugins (global id space). Linux
without a keyring degrades to obfuscation. Secrets are **device-local** → re-enter on a new machine.

## Remaining work — DONE

All three follow-ups landed (see the "phase-3 + snippet + i18n" commits).

1. **Phase 3 — MCP auth headers / stdio env via SecretStorage. ✅**
   - New pure module `src/core/mcp/mcpSecrets.ts`: `extractMcpServerSecrets` (one-time migration: move
     secret-shaped plaintext header/env values into SecretStorage, record `secretHeaders` / `secretEnv`
     name→id refs, strip plaintext; idempotent, collision-proof against `store.list()`) and
     `resolveMcpServerConfig` (overlay resolved values at launch; a missing secret is omitted, never
     injected empty).
   - Storage: `ManagedMcpServer` + `_claudian.servers[name]` carry `secretHeaders` / `secretEnv`
     (`src/core/types/mcp.ts`). `McpStorage` round-trips them and **defensively strips** any
     secret-referenced key from the persisted `mcpServers` plaintext.
   - Resolution: `McpServerManager` takes a `secretResolver` and overlays secrets in `getActiveServers`
     **before** SEC-4 curation; `McpTester.testMcpServer(server, resolveSecret?)` verifies against the
     resolved config. Configs reach the SDK in-memory (`options.mcpServers` / `setMcpServers`), so the
     **safe default — resolve fully in-plugin** — was taken (no reliance on CLI `${VAR}` expansion; couldn't
     smoke-test the CLI in the build container).
   - UI/migration wiring: secret-shaped values typed into the MCP editor textareas are migrated on save
     (`McpSettingsManager.persistServers`); existing plaintext is migrated once on workspace init
     (`ClaudeWorkspaceServices`); the modal preserves existing refs across edits.
2. **Snippet-scoped secret refs (`snippet:<id>`). ✅** `EnvironmentScope` extended; `migrateEnvSecrets`
   now migrates saved snippets' `envVars` under `snippet:<id>` (inert at launch — resolution ignores
   snippet scopes); `resolveSnippetEnvText` re-injects on insert; delete prunes refs
   (`pruneScopeSecretRefs`).
3. **i18n. ✅** `SecretEnvVarsSection` strings routed through `t()` with new `env.secret*` keys across all
   10 locales.

The `isSecretEnvKey`/`isSecretHeaderName` detection remains migration-only/advisory.

## Verify

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```
At HEAD `ae643cc`: typecheck/lint/build clean; unit 6606 pass (1 skip), integration 236 pass. Secret tests:
`tests/unit/core/security/*`, `tests/unit/core/providers/secretEnvVars.test.ts`,
`tests/unit/core/providers/EnvHashReconciler.test.ts`, `tests/unit/features/settings/SecretEnvVarsSection.test.ts`.
