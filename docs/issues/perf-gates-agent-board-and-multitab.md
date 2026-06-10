---
type: issue
id: issue-20260603-perf-gates-board-multitab
title: Add perf gates for Agent Board scaling and multi-tab concurrent streaming
status: done
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-09
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (PR-2)"
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
scope: performance-monitoring
tags:
  - performance
  - testing
  - agent-board
---

# Perf gates: Agent Board + multi-tab streaming

## Problem

The perf suite (`messageRenderer`, `toolCallIndex`, `claudeHistory`, `codexHistory`,
`conversationHistory`, `conversationLoad`, `navigationSidebar`) has **zero coverage** for: Agent Board
rendering as work-order count grows, `TaskRunCoordinator` concurrent-run scaling, multi-tab streaming
(N tabs each running their own `StreamController` rAF loop sharing the scheduler), and MCP server
enumeration. Agent Board is now a first-class feature, and multi-tab concurrent streaming is the highest
real-world scaling risk — exactly the kind of gap that masked PERF-4.

## Proposed change

Add to `tests/perf/`:

- `agentBoard.perf` — board render scales O(window) with work-order count.
- A `taskRunCoordinator` concurrency guard.
- A multi-tab streaming gate (N concurrent `StreamController` loops).

Follow the existing pattern: deterministic scaling assertions + report-only metrics (no timing asserts).

## Acceptance criteria

- New perf specs run under `jest.perf.config.js`, assert bounded scaling, and stay out of `npm test`/CI/coverage.

## Resolution (2026-06-09)

All three proposed gates shipped under `tests/perf/`, following the existing pattern
(deterministic scaling assertions + report-only metrics tables, no timing asserts):

- **`agentBoard.perf.test.ts`** — guards `AgentBoardRenderer` at N = 50/200/1000 work orders.
  The board mounts every card today (no render window), so the durable contract asserted is:
  full `render()` stays ~linear (per-card DOM-node and listener cost flat, no super-linear
  blow-up), and the streaming hot paths are O(1) — `patchLiveStrip` (heartbeat repaint) causes
  zero node/listener churn at any board size, and `patchCard` (running→review transition) has
  an identical, small constant DOM/listener delta at 50 and 1000 cards.
- **`taskRunCoordinator.perf.test.ts`** — guards run coordination: `TaskRunCoordinator.run()`
  consults the provider/model eligibility predicates exactly once per launch regardless of
  active-run count (5/50/500 in-flight runs), duplicate launches reject before any predicate,
  and a multi-slot `QueueRunner` drain pass launches ≤ slot capacity with eligibility probes
  bounded by `cap × runnable` and provably independent of terminal-card count (200 vs 2000
  boards yield identical probe counts). Complements the existing capacity-1 `queueRunner.perf`.
- **`multiTabStreaming.perf.test.ts`** — drives real `StreamController` + `ChatState`
  instances (1/8/32 tabs) over a shared deterministic counting frame scheduler (the rAF seam
  all tabs in one window share). Guards: chunk bursts coalesce to a constant ≤ 2 pending
  callbacks per tab (5 vs 200 chunks identical), one tab's per-flush render count is
  unchanged by 31 concurrent streaming tabs, total scheduler pressure is exactly
  O(active tabs), and markdown re-renders track frames, not chunk arrival rate.

Verified with `npm run test:perf`: 12 suites / 23 tests pass. MCP server enumeration (named
in the problem statement but not in the proposed change) remains uncovered — tracked in
[[2026-06-07-perf-gates-blind-spots]].
