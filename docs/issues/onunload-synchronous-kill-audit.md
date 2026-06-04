---
type: issue
id: issue-20260603-onunload-kill-audit
title: Ensure onunload fires child.kill() synchronously before any await (no orphaned CLI processes)
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (PR-1)"
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
