---
type: issue
id: issue-20260603-onunload-kill-audit
title: Ensure onunload fires child.kill() synchronously before any await (no orphaned CLI processes)
status: done
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-09
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (PR-1)"
scope: lifecycle
tags:
  - reliability
  - lifecycle
  - subprocess
---

# onunload synchronous-kill audit

## Problem

`onunload()` is synchronous (Obsidian contract) but calls `this.lifecycle.shutdownActiveRuntimes()` which
does `void tab.service?.cleanup()` and `void persistOpenTabStates()` (fire-and-forget). The SIGTERM/kill
is *initiated* synchronously but the async cleanup may not complete before the process tears down — risking
**orphaned CLI subprocesses** and lost tab state on plugin disable/reload. (The per-tab `destroyTab` path
correctly `await`s cleanup; the unload path cannot.)

## Evidence

- `src/main.ts:162-167`; `src/app/lifecycle/PluginLifecycle.ts:30-52`.
- Contrast `tabLifecycle.ts:197-200` (awaited).

## Proposed change

Keep the synchronous SIGTERM initiation (best achievable in `onunload`), but **audit every provider's
`cleanup()` to confirm it issues `child.kill()` before its first `await`** so the signal always fires.
Accept tab-state-persist as best-effort.

## Acceptance criteria

- Each provider `cleanup()` verified to call `child.kill()` pre-await (Codex/ACP/Cursor staged
  SIGTERM→SIGKILL confirmed initiated synchronously).
- A test or documented audit confirms no runtime defers its kill behind an await.

## Resolution (2026-06-09)

Audited the full chain `src/main.ts` `onunload()` (line 381: `this.lifecycle?.shutdownActiveRuntimes()`)
→ `src/app/lifecycle/PluginLifecycle.ts:30-42` (`void tab.service?.cleanup()` per tab, fire-and-forget)
→ each provider runtime's `cleanup()`. **All four providers initiate the child-process kill synchronously,
before the first `await` in the `cleanup()` call frame. No source fix was required.**

Key mechanics relied on (and now guarded by tests): a JS `async` function body runs synchronously up to
its first `await`, and a `new Promise(executor)` executor runs synchronously — so `await new Promise(...)`
patterns whose executor calls `proc.kill('SIGTERM')` still issue the signal inside the caller's frame.

### Findings per provider

| Provider | `cleanup()` | Kill path | Pre-await? |
|----------|-------------|-----------|------------|
| Claude | `src/providers/claude/runtime/ClaudeChatRuntime.ts:1798` (fully synchronous, not `async`) | `closePersistentQuery()` (line 583) calls `queryAbortController.abort()` at line 601; `cancel()` aborts the cold-start `abortController` (line 1681). The SDK child is killed by the spawn-side abort listener in `src/providers/claude/runtime/customSpawn.ts:43-46` — `AbortSignal` listener dispatch is synchronous per spec (including chained/dependent signals inside the SDK), so `abort()` → `child.kill()` fires in the same frame. `persistentQuery.interrupt()` (line 596) is an additional async, best-effort signal. | Yes |
| Codex | `src/providers/codex/runtime/CodexChatRuntime.ts:629` — sync `cancel()`/`teardownState()`, then `await this.shutdownProcess()` | `shutdownProcess()` (line 887) disposes the transport synchronously then evaluates `this.process.shutdown()`; `CodexAppServerProcess.shutdown()` (`src/providers/codex/runtime/CodexAppServerProcess.ts:123-157`) has no `await` before its Promise executor calls `proc.kill('SIGTERM')` (line 152), with SIGKILL escalation + hard give-up ceiling on timers. | Yes |
| Opencode (ACP) | `src/providers/opencode/runtime/OpencodeChatRuntime.ts:518` — sync queue close, then `await this.shutdownProcess()` | `shutdownProcess()` (line 657) is synchronous teardown until `await this.process.shutdown()`; `AcpSubprocess.shutdown()` (`src/providers/acp/AcpSubprocess.ts:93-128`) calls `proc.kill('SIGTERM')` (line 122) inside the Promise executor before suspending, with SIGTERM→SIGKILL staging + give-up ceiling. | Yes |
| Cursor | `src/providers/cursor/runtime/CursorChatRuntime.ts:341` — `await this.terminateChild()` | `terminateChild()` (line 272) is a non-async method; its Promise executor calls `child.kill('SIGTERM')` (line 310) synchronously, with `forceKillCursorProcessTree` escalation (Windows tree-kill) + give-up ceiling. | Yes |

Notes:
- The unload path's `void tab.service?.cleanup()` cannot await completion (Obsidian's `onunload` is
  synchronous); the audit confirms the SIGTERM is *issued* in-frame for every provider, which is the best
  achievable guarantee. SIGKILL escalation runs on timers and is inherently best-effort during app quit.
- Tab-state persistence (`void this.lifecycle?.persistOpenTabStates()`) remains accepted as best-effort.
- Contrast path: per-tab `destroyTab` (`src/features/chat/tabs/tabLifecycle.ts`) still awaits cleanup.

### Tests added (guard the in-frame kill)

- `tests/unit/providers/acp/AcpSubprocess.test.ts` (new file): SIGTERM issued synchronously within the
  `shutdown()` call frame; SIGKILL escalation; give-up ceiling; already-exited no-op.
- `tests/unit/providers/codex/runtime/CodexAppServerProcess.test.ts`: SIGTERM issued synchronously within
  the `shutdown()` call frame.
- `tests/unit/providers/codex/runtime/CodexChatRuntime.test.ts`: `cleanup()` reaches `process.shutdown()`
  synchronously in the `cleanup()` call frame.
- `tests/unit/providers/cursor/runtime/CursorChatRuntime.test.ts`: `cleanup()` issues SIGTERM synchronously
  within the `cleanup()` call frame.
- `tests/unit/providers/opencode/OpencodeChatRuntime.test.ts`: `cleanup()` reaches `process.shutdown()`
  synchronously in the `cleanup()` call frame.
- `tests/unit/providers/claude/runtime/ClaudianService.test.ts`: `cleanup()` aborts the query
  `AbortController` synchronously in the call frame (the abort→`child.kill()` synchronicity at the spawn
  seam is covered by the existing `customSpawn.test.ts` "kills child when signal aborts after spawn").
