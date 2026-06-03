---
type: issue
id: issue-20260603-value-level-redaction
title: Harden diagnostics redaction — scrub secret-bearing values and normalize home paths
status: open
priority: 3 - low
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (SEC-E)"
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

- Add value-level scrubbing for `user:pass@` in URLs/command strings.
- Normalize `os.homedir()` → `~` in `formatLogEntries`/redact before the clipboard export.

## Acceptance criteria

- A test asserting a `user:pass@host` value and a home-dir path are redacted/normalized in exported logs.
