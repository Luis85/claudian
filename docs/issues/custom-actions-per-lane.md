---
type: issue
id: issue-20260603-custom-actions-per-lane
title: Custom action buttons per Agent Board lane / work-order type
status: open
priority: 3 - low
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[Custom Actions per Lane or Work-Order Type]]"
related:
  - "[[agent-board-configurable-lanes]]"
  - "[[2026-06-07-agent-board-redesign-plan]]"
scope: agent-board
tags:
  - agent-board
  - configurable-workflow
---

# Custom actions per lane / work-order type

## Problem

Agent Board lanes are configurable for layout only — there are no per-lane custom action buttons (or
lane-scoped quick actions) that fire a prompt for cards in that lane. Lane config
(`src/features/tasks/config/boardConfigTypes.ts`, `ui/AgentBoardLaneEditor.ts`) covers names/order/visibility
but no actions (grep: no `laneAction`/`customAction`/`actionButton` in `src/features/tasks/`).

## Proposed change

Let a lane (or work-order type) define custom action buttons that run a configured prompt against the
card's work order, surfaced on the card / lane. Keep defaults action-free so existing boards are unchanged.

## Acceptance criteria

- A lane can define ≥1 custom action; the button appears on cards in that lane and runs the configured prompt.
- Config persists as readable Markdown/JSON alongside the existing lane config; defaults unchanged.
