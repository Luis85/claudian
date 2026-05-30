---
status: done
type: issue
tags:
  - infrastructure
priority: 1 - high
relations:
  - Infrastructure
---
# Insufficient logging

## Problem

Without proper logging it gets hard to trace bugs. We need proper logging which shall be configurable in the general settings of the plugin.

Concretely, this already cost us: an intermittent Claude `400 ... thinking blocks ... cannot be modified` error surfaced during Agent Board reruns. With no durable, leveled logs we could not capture the failing turn's state on demand — we had to hand-add temporary `console.warn` instrumentation and ask the user to reproduce with DevTools open. A real logger would have captured it the first time.

## Current state

- **No central logger.** Diagnostics are ad-hoc `console.*` calls added and removed by hand.
- **`console.*` is discouraged** by the project guideline (CLAUDE.md: "No `console.*` in production code"). Note: the ESLint config does not currently flag `console.warn` as an error, so the guideline is convention-only and unenforced.
- **Temporary diagnostics were used and reverted:** during the 400 investigation we added three `console.warn('[claudian-diag] claude.query ...')` calls in `src/providers/claude/runtime/ClaudeChatRuntime.ts` (query start + persistent/cold-start error paths), then reverted them during cleanup. Reintroduce equivalent instrumentation through the real logger when implementing this — that path (query start + error) is a good first place to log.
- Scattered `console.*` likely exists elsewhere and would be migrated too.

## Requirements

- **Configurable in General settings:**
  - log level: `off | error | warn | info | debug` (default `warn` or `off`).
  - enable/disable toggle.
- **Shared `Logger`** used across the plugin (core + providers + features), replacing scattered `console.*` and the temp Agent Board / Claude diagnostics.
- **Cheap when disabled** — no string building / object work when the active level filters a message out (guard or lazy args).
- **Namespaced** — e.g. `logger.scope('claude.runtime')` / `logger.scope('tasks.board')` so output is filterable by area.

## Open questions (for design)

- **Destinations:** DevTools console only, or also a rotating log file in the vault (e.g. `.claudian/logs/`)? File logging helps users share logs but raises size/rotation/secrets concerns.
- **Per-namespace levels** vs a single global level.
- **Redaction:** never log secrets (`.env*`, credentials, provider keys) or full prompts/transcripts at non-debug levels.
- **Surfacing:** should `error` also raise an Obsidian `Notice`, or stay console/file only?
- **Performance:** ensure the hot streaming path pays ~zero cost when logging is off.

## Related

- Triggering case: intermittent Claude thinking-block 400 on Agent Board reruns (see `docs/issues/agent-board-mvp.md` context and the `[claudian-diag]` instrumentation in `ClaudeChatRuntime.ts`). That bug is still unpinned (intermittent; not reproduced under normal or concurrent runs so far) — a real logger is the prerequisite to capturing it.

## Status

Deferred. To be tackled as its own brainstorm → spec → plan increment.
