---
type: issue
id: issue-20260603-secretstorage-plaintext-secrets
title: Stop storing provider keys and MCP auth headers in plaintext — adopt Obsidian SecretStorage
status: done
priority: 1 - high
triage: shipped
created: 2026-06-03
updated: 2026-06-07
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (SEC-A / OBS-A)"
related:
  - "[[2026-05-28-plugin-improvement-research-proposal]]"
  - "[[2026-06-03-secretstorage-secrets]]"
  - "[[2026-06-04-sec-a-secretstorage]]"
scope: secrets-at-rest
tags:
  - security
  - privacy
  - secrets
  - obsidian-compliance
---

# Adopt Obsidian SecretStorage for secrets at rest

> **Status (2026-06-07): shipped.** PR #27 and follow-up fixes landed SEC-A Phases 0–4.
> Provider API keys, shared/provider/snippet env secrets, MCP auth headers, and MCP env vars now persist as
> SecretStorage references backed by Obsidian `app.secretStorage`, not as raw values in vault config.
> `manifest.json` is at `minAppVersion: 1.11.5`; 1.11.4 was deliberately skipped because it stored secrets
> in plaintext localStorage. Runtime and in-app MCP paths resolve the refs before child spawn / MCP test.
> Value-level diagnostics redaction is covered separately by [[value-level-diagnostics-redaction]].

## Problem

Provider API keys, MCP HTTP auth headers (incl. `Authorization` bearer tokens), and per-provider env vars
are persisted **in cleartext** into the in-vault `.claudian/claudian-settings.json` and `.claude/mcp.json`
— both routinely committed to git or synced (Obsidian Sync, iCloud, Dropbox). Obsidian's
`SecretStorage`/`SecretComponent` API (Electron `safeStorage`-backed; shipped v1.11.4, Jan 2026) is
**not used anywhere** (0 grep hits). Anyone with the vault or its sync target gets every long-lived secret.
This is the highest-impact privacy gap for the target audience and now a flaggable Obsidian
automated-review anti-pattern.

## Original evidence (stale; kept for context)

These observations described the pre-SEC-A tree and should not be used as current-state evidence:

- `src/providers/.../providerEnvironment.ts:180-185` documented cleartext persistence.
- `McpStorage.save` → `.claude/mcp.json:124` wrote `headers` verbatim.
- `src/core/types/mcp.ts:15,22` stored `headers?: Record<string,string>` only.

Current substrate: `src/core/security/secretStore.ts`, `src/core/security/secretIds.ts`,
`src/core/providers/secretEnvVars.ts`, `src/core/mcp/mcpSecrets.ts`, `src/features/settings/ui/SecretEnvVarsSection.ts`,
`src/features/settings/ui/McpServerModal.ts`, and `src/core/mcp/McpTester.ts`.

## Proposed change

- Store API keys + MCP auth headers via Obsidian `SecretStorage` (out-of-vault, OS-keychain).
- Keep `.claude/mcp.json` referencing secrets via Claude Code's documented `.mcp.json` expansion syntax
  **`${VAR}` / `${VAR:-default}`** (NOT an `env:` namespace — that form will not resolve and would break
  authenticated servers). Claudian injects the resolved values into the child process env at launch.
- **Resolve secret refs for the in-app MCP transport too, not just provider child spawns.** The in-app MCP
  Test/management path (`McpTester`/manager) runs in the **plugin process** and passes `config.headers`
  **directly** into the MCP SDK transport — it does not go through the provider CLI child. So once plaintext
  headers are removed, the Test/management path must resolve the SecretStorage-backed header/`${VAR}` refs
  before constructing the transport, or the Test button will send literal placeholders / missing auth.
- Add a migration scan for existing plaintext secrets.

## Compatibility requirement

`SecretStorage` shipped in Obsidian 1.11.4 but `manifest.json` `minAppVersion` is `1.7.2`. The migration
PR must either bump `minAppVersion` to ≥1.11.4 **or** feature-detect `app.secretStorage` and fall back
gracefully for 1.7.2–1.11.3 installs (otherwise settings/provider-launch paths hit missing APIs).

## Stopgap (ship first, disclosure only — NOT relocation)

There is **no reliably-unsynced vault path** (`Plugin.saveData`'s `data.json` lives under
`.obsidian/plugins/<id>/`, which Obsidian Sync/iCloud and a committed `.obsidian` also capture). The
stopgap is therefore: a prominent in-settings plaintext-at-rest warning + sync/git-exclusion guidance.

## Acceptance criteria

- [x] New secrets persist through `SecretStorage`; `.claudian`/`.claude` store only refs for migrated provider/env/MCP secrets.
- [x] Runtime child-spawn and in-app MCP test/management paths resolve SecretStorage refs before use.
- [x] Existing plaintext provider/env/MCP secrets are migrated best-effort on load/save paths.
- [x] Compatibility resolved by bumping `manifest.json` `minAppVersion` to `1.11.5` (no pre-SecretStorage fallback).
- [x] Diagnostics/log redaction covers secret-shaped keys and value-embedded bearer/API-key/userinfo tokens; see [[value-level-diagnostics-redaction]] for the dedicated follow-up.

## Shipped references

- Implementation plan: [[2026-06-03-secretstorage-secrets]]
- Handoff: [[2026-06-04-sec-a-secretstorage]]
- Merge: PR #27 (`2a13af19`) plus follow-up hardening commits (`ecedf833`, `6f5ff0d7`, `bc73408d`, `8af12eb0`, `d335cb67`, `721011b1`, `7b99ac51`, `f090f22a`, `343a34a3`, `936bdf8a`, `ef226119`).
