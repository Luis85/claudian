---
type: issue
id: issue-20260603-orchestrator-board-integration
title: Integrate the Orchestrator with the Agent Board (parallel work orders + combined review)
status: closed
priority: 2 - normal
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (D4); [[Integrate the Orchestrator with the Agent Board]]"
related:
  - "[[agent-board-evidence-review]]"
  - "[[agent-board-background-runs]]"
scope: agent-board-orchestration
tags:
  - agent-board
  - orchestrator
  - wont-do
---

Superseded by [[2026-06-06-remove-orchestrator-feature-design]]: Orchestrator was **removed** 2026-06-06 instead of being integrated with the Agent Board. The Agent Board is now the only orchestration surface. Sections below are kept as historical record of the original problem framing.

# Orchestrator ↔ Agent Board integration (historical)

## Problem (historical)

The Orchestrator shipped as a chat service that spawned tabs, but it was **not integrated with the Agent
Board** (no `orchestrat*` references in `src/features/tasks/`). The "spec → parallel work → combined
review" promise was largely manual, and the orchestrator's parallel-task output was not turned into board
work orders with ledger/handoff/evidence.

## Resolution

Killed by [[Remove the Orchestrator feature]] (status: done, 2026-06-06). The parallel-runs ambition lives
on as [[agent-board-background-runs]] + [[agent-board-evidence-review]], handled inside the Agent Board.
