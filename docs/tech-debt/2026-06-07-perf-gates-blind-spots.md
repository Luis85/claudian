---
type: tech-debt
title: "Performance gates miss Agent Board and concurrent streaming hot paths"
date: 2026-06-07
updated: 2026-06-10
status: done
priority: "2 - normal"
severity: medium
scope: performance-testing
tags:
  - tech-debt
  - performance
  - testing
  - agent-board
related:
  - "[[perf-gates-agent-board-and-multitab]]"
  - "[[2026-06-07-agent-board-evidence-gate]]"
---

# Performance gates miss Agent Board and concurrent streaming hot paths

## Summary

The repo has a useful perf suite, but it is explicitly monitoring-only and does not cover the newest high-risk surfaces: Agent Board scaling, queue/concurrent run coordination, multi-tab streaming, and MCP server enumeration.

## Evidence

- `CLAUDE.md` says `tests/perf/*.perf.test.ts` are excluded from `npm test`, CI, and coverage.
- Existing perf specs cover message rendering, tool lookup, provider history parsing, conversation load, navigation sidebar, queue runner, and usage emission.
- [[perf-gates-agent-board-and-multitab]] remains open for Agent Board and multi-tab concurrent streaming gates.
- Current Agent Board files are sizeable and active: `AgentBoardView.ts` (892 nonblank LOC), `RunSession.ts` (625), `AgentBoardRenderer.ts` (533), and `QueueRunner.ts` (310).

## Why it matters

The Agent Board is the feature most likely to create many live cards, many active runs, and many streaming tabs. Those are scaling risks that ordinary unit tests do not catch. The previous long-chat work showed why deterministic scaling assertions are valuable before users report jank.

## Suggested remediation

1. Add `agentBoard.perf` for rendering many work orders and lanes.
2. Add a `TaskRunCoordinator` / queue concurrency perf guard.
3. Add a multi-tab streaming perf guard that simulates N active `StreamController` loops sharing scheduler resources.
4. Add an MCP enumeration perf guard if unified MCP management expands across providers.
5. Decide which perf checks remain report-only and which become CI gates with deterministic thresholds.

## Acceptance criteria

- [x] Perf suite covers Agent Board rendering growth.
- [x] Perf suite covers multi-tab concurrent streaming.
- [x] CI runs at least deterministic perf gates that do not depend on wall-clock timing.
- [x] Report-only timing metrics stay separated from pass/fail assertions.

## Progress (2026-06-09)

Remediation items 1–3 shipped (see [[perf-gates-agent-board-and-multitab]], now `done`):

1. **Agent Board rendering** — `tests/perf/agentBoard.perf.test.ts` guards full-board render
   linearity (flat per-card DOM/listener cost at 50/200/1000 cards) and O(1) live patches
   (`patchLiveStrip` zero-churn, `patchCard` constant delta independent of board size).
2. **Queue / run-coordination concurrency** — `tests/perf/taskRunCoordinator.perf.test.ts`
   guards O(1) launch validation vs active-run count and multi-slot drain passes bounded by
   capacity × runnable, independent of terminal-card count (complements `queueRunner.perf`).
3. **Multi-tab streaming** — `tests/perf/multiTabStreaming.perf.test.ts` drives 1/8/32 real
   `StreamController` instances over a shared counting frame scheduler: constant pending
   callbacks per tab per frame, per-tab render work independent of other open tabs.

## Resolution (2026-06-10)

5. **CI gating decided and shipped**: the whole perf suite now runs as the
   blocking `perf` job in `.github/workflows/ci.yml` (`npm run test:perf`).
   The policy: every pass/fail assertion in `tests/perf/*` is a deterministic
   count (DOM nodes, listeners, scheduler callbacks, parse passes) against a
   bounded window — never a wall-clock timing — so the suite is stable on
   shared runners. Timing tables remain report-only monitoring in the job log
   (`CLAUDIAN_PERF_JSON` for trend capture stays opt-in, local). The suite
   stays excluded from `npm test` and coverage.

Retired without action:

4. MCP server enumeration perf guard — still not warranted; revisit if unified
   MCP management expands across providers (reopen or file a fresh note then).
