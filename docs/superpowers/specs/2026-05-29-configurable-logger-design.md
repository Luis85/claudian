---
status: shipped
parent: Infrastructure
---
# Configurable Logger Design

Date: 2026-05-29
Source issue: [[insufficient logging]]

## Summary

Add a small, typed, leveled, namespaced logger so the plugin has one diagnostic
sink instead of ad-hoc `console.*` calls added and removed by hand. Output goes
to the DevTools console (when the level passes) and to a bounded in-memory ring
buffer that the user can export on demand. Configurable in General settings:
enable toggle + level. Internal only.

The motivating case: an intermittent Claude `400 ... thinking blocks ... cannot
be modified` error during Agent Board reruns could not be captured on demand. We
had to hand-add `console.warn` instrumentation and ask the user to reproduce with
DevTools open. A ring buffer + export means the failing turn's state is already
captured the first time.

## Goals

- A generic, typed `Logger` in `core/` with no Obsidian dependency (unit-testable).
- Leveled (`off | error | warn | info | debug`) with a single global threshold.
- Namespaced via `logger.scope('claude.runtime')`, output filterable by area.
- Cheap when filtered — the hot streaming path pays ~zero cost when the level is off.
- Bounded in-memory ring buffer + a "copy logs" export for sharing.
- Redaction by default — never log secrets or full prompts/transcripts at non-debug.
- Replace the lone `console.*` and reintroduce the Claude 400 diagnostics through the logger.

## Non-goals

- Vault log file / rotation (`.claudian/logs/`). Considered and deferred; ring
  buffer + export covers the share-a-log need without on-disk secret/rotation concerns.
- Per-namespace level overrides. The API is namespaced now; a single global
  threshold gates all. Override map deferred.
- Surfacing errors as Obsidian `Notice` toasts. Logger stays a silent diagnostic
  sink; user-facing errors keep flowing through existing UI.
- Public/external logging API.

## Decisions

| Question | Decision |
|----------|----------|
| Foundation | Typed standalone `Logger` class in `core/logging/` (no Obsidian dep) |
| Destinations | DevTools console + bounded in-memory ring buffer |
| Levels | Single global threshold; namespaced API via `scope()` |
| Export | `Copy diagnostic logs` + `Clear logs` commands; buttons in General settings |
| Surfacing | Silent — no `Notice` on error |
| Redaction | On by default; mask secret-keyed args, truncate bodies, never log `.env*`/keys |
| Ownership | One `Logger` owned by the plugin, accessed as `plugin.logger` |
| Cheap-when-off | Early-return before touching args; `isEnabled(level)` guard for hot paths |

## Architecture

### Layering

- `src/core/logging/Logger.ts` — generic `Logger`. No imports from `features/` or
  `app/`. Unit-testable in isolation.
- `src/core/logging/types.ts` — `LogLevel`, `LogEntry`, `LoggerOptions`.
- `src/main.ts` — `readonly logger = new Logger({ ... })` created early in `onload`
  (before features), exposed as `plugin.logger`. Reads `logLevel` / `loggingEnabled`
  from settings; re-reads on settings change.

Features/providers log through `plugin.logger.scope('area')`. The type flows from
`ClaudianPlugin` (which features already import), so no feature imports a global.

### Logger

```ts
export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  ts: number;
  level: Exclude<LogLevel, 'off'>;
  scope: string;
  msg: string;
  args: unknown[];   // already redacted
}

export interface Logger {
  error(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  isEnabled(level: LogLevel): boolean;  // guard before building expensive args
  scope(ns: string): Logger;            // child; shares root threshold + buffer
  setLevel(level: LogLevel): void;       // live re-read from settings
  setEnabled(enabled: boolean): void;
  snapshot(): LogEntry[];                // buffer copy for export
  clear(): void;
}
```

- Levels rank `off(0) < error(1) < warn(2) < info(3) < debug(4)`. A call at level L
  emits when `enabled && threshold >= L`. `off` (or disabled) = fully silent.
- Each method early-returns on the threshold check **before** evaluating/redacting
  `...args`, so a filtered call is a cheap no-op.
- `isEnabled(level)` exposes the same check so callers can guard arg-building:
  `if (logger.isEnabled('debug')) logger.debug('turn', expensiveDump())`.
- `scope(ns)` returns a child that prepends `ns` to the entry's `scope` and delegates
  to the root (shared threshold, shared buffer). Nested `scope` joins with `.`.

### Ring buffer

- Root logger owns a fixed-capacity buffer (default 500 entries; constant, not a setting).
- On each emitted entry: redact args, write to console (via the matching `console`
  method), push to buffer, evict oldest when over capacity.
- The buffer mirrors what passes the threshold. With logging off, nothing is captured.
- `snapshot()` returns a copy; `clear()` empties it.

### Export

- Command `Claudian: Copy diagnostic logs` — formats `snapshot()` to plain text
  (`ISO ts  LEVEL  [scope]  msg  args`) and writes to clipboard, then a `Notice`
  ("Copied N log entries").
- Command `Claudian: Clear diagnostic logs` — calls `clear()`.
- General settings exposes the same two as buttons.

### Redaction (firm, non-negotiable)

Runs before both console and buffer writes, so secrets never reach either:

- Object args: keys matching `/(token|key|secret|password|credential|api[-_]?key|authorization|cookie)/i`
  are replaced with `'[redacted]'` on a cloned copy, walking nested objects — never mutate caller data.
- Never log `.env*` contents, provider config bags, or private keys.
- Prompt/transcript bodies log only at `debug`, truncated (default 500 chars, with `…[+N]`).
- Aligns with the project secret-deny-by-default posture.

## Settings + UI

- `ClaudianSettings` gains:
  - `loggingEnabled: boolean` (default `false`)
  - `logLevel: LogLevel` (default `'warn'`)
- `DEFAULT_CLAUDIAN_SETTINGS` updated with both.
- General settings section: enable toggle, level dropdown, "Copy logs" + "Clear logs" buttons.
- On settings save, the plugin calls `logger.setEnabled()` / `logger.setLevel()` so the
  threshold changes live without reload (no need to route through the event bus for MVP).

## First Consumers / Migration

- Replace the lone `console.warn` in `src/providers/cursor/app/CursorWorkspaceServices.ts`
  with `plugin.logger.scope('cursor.workspace')`.
- Reintroduce the Claude 400 diagnostics (previously added then reverted) in
  `src/providers/claude/runtime/ClaudeChatRuntime.ts` via `logger.scope('claude.runtime')`:
  - query start → `debug`
  - persistent / cold-start error paths → `error`
  This is the payoff: the next 400 repro is captured in the buffer with no hand-instrumentation.
- `EventBus` error sink: the event-bus spec swallows handler errors with a
  `// TODO: route to logger` marker. Give `EventBus` an optional error-sink callback
  and wire it to `plugin.logger.scope('events').error(...)` at construction. Closes that TODO.
- Enforce the convention: add eslint `no-console` (error) so future `console.*` is
  flagged and devs are routed to the logger. Closes the "convention-only, unenforced" gap.

## Error Handling

- The logger never throws into callers. A console write or redaction failure is caught
  internally; the buffer push still proceeds where possible.
- `Copy logs` with an empty buffer shows a `Notice` ("No log entries") rather than
  writing empty clipboard content.

## Testing Plan

TDD, mirrored under `tests/unit/core/logging/`.

### `Logger` (unit)
- Level gating: each level emits at/above threshold and is silent below; `off` and
  `enabled=false` are fully silent.
- `isEnabled(level)` truth table matches the gating.
- Cheap-when-off: a filtered call does not invoke `console` (spy) and does not touch
  a side-effecting arg builder (assert the builder is not called when guarded).
- `scope(ns)` prepends the namespace; nested scopes join with `.`; child shares the
  root threshold and writes into the root buffer.
- Ring buffer caps at N and evicts oldest; `snapshot()` returns a copy (mutating it
  does not affect the buffer); `clear()` empties it.
- Redaction: secret-keyed object args are masked; caller's object is not mutated;
  oversized bodies truncate at the limit.
- `setLevel` / `setEnabled` change behavior live.

### Export formatting (unit)
- `snapshot()` → text is deterministic and includes ts/level/scope/msg.

### Integration / non-regression
- Toggling logging in settings flips the threshold without reload.
- Direct chat send/stream path is unaffected when logging is off (no cost, no behavior change).
- `EventBus` handler error routes to the logger error sink when one is configured.

## Manual Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Smoke test:
1. Enable logging at `debug` in General settings.
2. Run a work order / send a chat → entries appear in DevTools console with scopes.
3. `Copy diagnostic logs` → clipboard holds the formatted buffer.
4. Set level `off` → console quiet; hot path unaffected.
5. Confirm a secret-shaped value (e.g. an arg named `apiKey`) shows `[redacted]`.

## Acceptance Criteria

- A typed `Logger` exists in `core/logging/`, unit-tested, with no Obsidian dependency.
- Global level + enable toggle configurable in General settings; changes apply live.
- Namespaced API (`scope`) with a single shared threshold and shared ring buffer.
- Filtered calls are cheap no-ops; `isEnabled` guards hot paths.
- `Copy diagnostic logs` exports the buffer; `Clear diagnostic logs` empties it.
- Secret-keyed args are redacted and prompt/transcript bodies are truncated/gated to `debug`.
- The lone `console.*` is migrated; Claude 400 diagnostics are reintroduced via the logger.
- `no-console` eslint rule enforces the convention.
- All existing tests pass; new logger tests pass.

## Risks

- Buffer holds redacted-but-still-sensitive context in memory — bounded size + redaction
  mitigate; export is user-initiated and copies to clipboard only (no disk).
- Redaction is heuristic (key-name based); a secret in an unrecognized field could leak
  to console/buffer — mitigated by truncating bodies and gating prompt/transcript content
  to `debug`. Document the redaction contract in `core/CLAUDE.md`.
- `no-console` may flag legitimate dev/test files — scope the rule to `src/` (exclude
  `dev/`, `tests/`, build scripts).
