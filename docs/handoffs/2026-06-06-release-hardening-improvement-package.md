---
title: Release-hardening improvement package
date: 2026-06-06
status: done
scope: security, obsidian-compliance, ux, release-hygiene
---

# Release-hardening improvement package

Comprehensive batch derived from the open backlog in `docs/issues/`, scoped to
release-readiness: the things Obsidian's per-release security review and our own
SEC/OBS triage flag. Each item is `triage: ready-for-agent`, has crisp
acceptance criteria, and is mostly file-disjoint so dedicated subagents can
implement them with low conflict risk.

Execution model: dedicated subagent per item, run as a RALPH loop on
`claude/work-order-note-race-fix-N0Q0P`. Each iteration is gated on
`npm run typecheck && npm run lint && npm run test` (targeted) before commit; a
failing gate re-dispatches the agent. A polishing pass follows once all land.

## Items

| # | Issue | Source tag | Priority | Primary surface |
|---|-------|-----------|----------|-----------------|
| 1 | `resolve-fork-naming-mismatch` | OBS-E | low | `manifest.json`, `README.md`, `scripts/release.mjs` |
| 2 | `codex-spawn-env-allowlist` | SEC-C | normal | `src/providers/codex/**` |
| 3 | `value-level-diagnostics-redaction` | SEC-E | low | `src/core/logging/redact.ts` |
| 4 | `audit-innerhtml-rendering` | OBS-B | high | rendering sites + eslint guard |
| 5 | `normalizepath-coverage` | OBS-C | normal | vault path construction sites |
| 6 | `actionable-runtime-error-states` | UX-F/UX-J | high | `StreamProjection` + chat error cards + i18n |

## Acceptance (rollup)

- No `process.env` spread into the Codex spawn; allowlist + `OPENAI_`/`CODEX_` prefix only, with a unit test.
- Diagnostics export scrubs bearer/api-key/`user:pass@` patterns inside string *values* and normalizes home paths.
- No `innerHTML`/`outerHTML`/`insertAdjacentHTML` site renders untrusted content; a lint/test guard prevents regression.
- User/agent-constructed vault paths pass through `normalizePath()`; coverage documented.
- Runtime CLI-not-found / auth / context-too-large failures render an actionable card (open settings / retry), not raw stream text.
- `manifest.json`, `README.md`, `scripts/release.mjs` reference one consistent identity (no silent `manifest.id`/storage-path change).

## Status log

- 2026-06-06: package created; baseline `typecheck`+`lint` green.
- 2026-06-06: all six items shipped via dedicated subagents (RALPH loop, sequential, each gated). Commits:
  - #1 fork/naming — `9590b8a`
  - #2 codex env allowlist — `84d8d56`
  - #3 value-level redaction — `579fa1c`
  - #4 innerHTML lint guard — `08365df` (audit found zero unsafe sites; guard added)
  - #5 normalizePath coverage — `9d2d772`
  - #6 actionable error cards — `05a1ff7`
- 2026-06-06: polishing pass — integrated gate green (`typecheck`, `lint`, `build`, **7647 unit tests pass**); diffs reviewed (all reuse existing plumbing, no fabricated paths; `projectErrorText`/`ERROR_PREFIX` dead code removed); related docs synced (source proposal rows annotated shipped; `CLAUDE.md` updates for redaction contract, render guard, normalizePath, chat renderer table; style module registered).

## Deferred / follow-ups

- Known-secret-value fingerprinting for diagnostics (SEC-E optional bullet) — needs SecretStorage plumbed into the logging layer; tracked alongside SEC-A.
</content>
