---
type: issue
id: issue-20260603-perf-gates-board-multitab
title: Add perf gates for Agent Board scaling and multi-tab concurrent streaming
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
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
