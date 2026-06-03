---
type: issue
id: issue-20260603-secretstorage-plaintext-secrets
title: Stop storing provider keys and MCP auth headers in plaintext — adopt Obsidian SecretStorage
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (SEC-A / OBS-A)"
related:
  - "[[docs/ideas/2026-05-28-plugin-improvement-research-proposal.md]]"
scope: secrets-at-rest
tags:
  - security
  - privacy
  - secrets
  - obsidian-compliance
---

# Adopt Obsidian SecretStorage for secrets at rest

## Problem

Provider API keys, MCP HTTP auth headers (incl. `Authorization` bearer tokens), and per-provider env vars
are persisted **in cleartext** into the in-vault `.claudian/claudian-settings.json` and `.claude/mcp.json`
— both routinely committed to git or synced (Obsidian Sync, iCloud, Dropbox). Obsidian's
`SecretStorage`/`SecretComponent` API (Electron `safeStorage`-backed; shipped v1.11.4, Jan 2026) is
**not used anywhere** (0 grep hits). Anyone with the vault or its sync target gets every long-lived secret.
This is the highest-impact privacy gap for the target audience and now a flaggable Obsidian
automated-review anti-pattern.

## Evidence

- `src/providers/.../providerEnvironment.ts:180-185` (documents the cleartext persistence).
- `McpStorage.save` → `.claude/mcp.json:124` writes `headers` verbatim.
- `src/core/types/mcp.ts:15,22` — `headers?: Record<string,string>`.

## Proposed change

- Store API keys + MCP auth headers via Obsidian `SecretStorage` (out-of-vault, OS-keychain).
- Keep `.claude/mcp.json` referencing secrets via Claude Code's documented `.mcp.json` expansion syntax
  **`${VAR}` / `${VAR:-default}`** (NOT an `env:` namespace — that form will not resolve and would break
  authenticated servers). Claudian injects the resolved values into the child process env at launch.
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

- New secrets persist through `SecretStorage`; `.claudian`/`.claude` no longer contain plaintext keys/headers.
- A test asserts diagnostics/transcripts never include keys/bearer tokens/header values unless opted in.
- Compatibility path verified on a sub-1.11.4 install (feature-detect or version bump).
