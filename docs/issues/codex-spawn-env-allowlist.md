---
type: issue
id: issue-20260603-codex-env-allowlist
title: Route the Codex spawn through the subprocess env allowlist (don't inherit full process.env)
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (SEC-C)"
scope: provider-spawn-env
tags:
  - security
  - subprocess
  - codex
---

# Codex spawn env allowlist

## Problem

`buildCodexAppServerEnvironment` spreads the entire host `process.env` as the spawn base, unlike Cursor
and Opencode which route through `buildAllowlistedSubprocessEnvironment`. Codex is an opt-in third-party
CLI launched with the vault as cwd, and it currently inherits every host secret (cloud creds, unrelated
tokens, `NODE_TLS_REJECT_UNAUTHORIZED` if set). The allowlist's rationale applies equally to Codex.

## Evidence

- `src/providers/codex/.../codexAppServerSupport.ts:24-33` (`Object.entries(process.env)` → spread at `:30`).
- Contrast `OpencodeRuntimeEnvironment.ts:16`, `cursorAgentEnv.ts`.

## Proposed change

Route Codex through `buildAllowlistedSubprocessEnvironment` with an `/^(OPENAI|CODEX)_/i` provider prefix.
Update the `src/core/CLAUDE.md` allowlist mandate to include Codex.

## Acceptance criteria

- The Codex subprocess receives only the allowlisted env + Codex-prefixed vars, not full `process.env`.
- A unit test asserts an unrelated host secret is absent from the Codex spawn env.
