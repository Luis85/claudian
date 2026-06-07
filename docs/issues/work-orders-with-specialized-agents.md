---
type: issue
id: issue-20260603-work-orders-specialized-agents
title: Attach a specialized agent definition to a work order
status: open
priority: 3 - low
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[Work-Orders with specialized Agents]]"
related:
  - "[[agent-board-evidence-review]]"
  - "[[2026-06-07-agent-board-redesign-plan]]"
scope: agent-board
tags:
  - agent-board
  - subagents
  - work-orders
---

# Work-orders with specialized agents

## Problem

A work order carries `provider?` and `model?` (`src/features/tasks/model/taskTypes.ts`) but **no agent
field** — there is no way to assign a specialized agent definition (subagent/skill) to a work order so its
run is specialized. (Distinct from `cursor-subagents`, which is provider-level subagent *support*; this is
work-order-level *assignment*.)

## Proposed change

Add an optional assigned-agent field to the work-order schema (when the provider supports agents), and use
it when starting the run so the work order executes as that agent. Surface/edit it on the card.

## Acceptance criteria

- A work order can optionally name an agent; the run uses it where the provider supports agents.
- Work orders without an agent behave exactly as today (no regression).
