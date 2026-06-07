---
type: issue
id: issue-20260603-value-level-redaction
title: Harden diagnostics redaction — scrub secret-bearing values and normalize home paths
status: done
priority: 3 - low
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (SEC-E)"
scope: logging-redaction
tags:
  - security
  - privacy
  - diagnostics
---

# Value-level redaction for diagnostics export

## Problem

`redact.ts` masks values whose **object key** matches the secret regex but does nothing for (a) secrets
inside string *values* (e.g. a logged `git clone https://x:TOKEN@host`, a thrown error embedding a token,
a URL under a non-secret key like `url`/`endpoint`), and (b) home/absolute paths (`/home/<user>/...`) that
routinely appear in errors and tool inputs and deanonymize the user. The clipboard export inherits exactly
the buffer's redaction, so these pass through.

## Evidence

- `src/core/logging/redact.ts:22-25` (tests `key` only; values recursed but never pattern-matched).
- No home-path scrubbing anywhere in `src/core/logging/`.

## Proposed change

`redact.ts` masks by **object key** only — secrets embedded inside non-secret string values pass through.
Add **value-level pattern scrubbing**, applied recursively to every string value before export:

- **Bearer tokens / auth headers** — e.g. `Authorization: Bearer <token>`, `token=...`, `api[-_]?key=...`,
  `sk-...`/provider-prefixed key shapes — even when they appear under a non-secret key like `message`,
  `endpoint`, `url`, or inside a thrown error string.
- **`user:pass@` credentials** in URLs/command strings.
- **Known secret values** — fingerprint/scrub the actual values of configured API keys / MCP header secrets
  so a verbatim leak is caught regardless of surrounding text.
- Normalize `os.homedir()` → `~` in `formatLogEntries`/redact before the clipboard export.

## Acceptance criteria

- Tests assert that a bearer token / API key embedded in a **value** (incl. under a non-secret key such as
  `message`/`endpoint` and inside an error string), a `user:pass@host` value, and a home-dir path are all
  redacted/normalized in exported logs.
- **Not done** while a known secret value or a `Bearer`/`api_key=` pattern can still appear in exported diagnostics.
