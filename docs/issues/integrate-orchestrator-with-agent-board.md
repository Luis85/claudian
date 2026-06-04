---
type: issue
id: issue-20260603-orchestrator-board-integration
title: Integrate the Orchestrator with the Agent Board (parallel work orders + combined review)
status: open
priority: 2 - normal
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (D4); [[docs/ideas/Integrate the Orchestrator with the Agent Board.md]]"
related:
  - "[[docs/issues/agent-board-evidence-review.md]]"
  - "[[docs/issues/agent-board-background-runs.md]]"
scope: agent-board-orchestration
tags:
  - agent-board
  - orchestrator
---

# Orchestrator ↔ Agent Board integration

## Problem

The Orchestrator ships as a chat service that spawns tabs, but it is **not integrated with the Agent
Board** (no `orchestrat*` references in `src/features/tasks/`). The "spec → parallel work → combined
review" promise is largely manual, and the orchestrator's parallel-task output is not turned into board
work orders with ledger/handoff/evidence.

## Proposed change

Wire the Orchestrator's parallel-task output into Agent Board work orders so each parallel task becomes a
tracked card with run ledger, handoff, and evidence; surface a combined review across the parallel lane.

## Acceptance criteria

- Orchestrator runs can materialize as Agent Board work orders (one card per parallel task) with ledger/handoff.
- A combined review surface spans the parallel set.

## Related

`agent-board-background-runs`, `agent-board-evidence-review`. Tracks the existing idea doc
`Integrate the Orchestrator with the Agent Board.md`.
