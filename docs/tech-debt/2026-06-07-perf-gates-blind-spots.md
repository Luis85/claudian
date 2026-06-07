---
type: tech-debt
title: "Performance gates miss Agent Board and concurrent streaming hot paths"
date: 2026-06-07
updated: 2026-06-07
status: open
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

- [ ] Perf suite covers Agent Board rendering growth.
- [ ] Perf suite covers multi-tab concurrent streaming.
- [ ] CI runs at least deterministic perf gates that do not depend on wall-clock timing.
- [ ] Report-only timing metrics stay separated from pass/fail assertions.
