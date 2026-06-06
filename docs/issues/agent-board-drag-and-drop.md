---
type: issue
id: issue-20260603-agent-board-drag-and-drop
title: Add drag-and-drop lane transitions to the Agent Board
status: open
priority: 3 - low
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (UX-G drag)"
related:
  - "[[accessibility-pass]]"
scope: agent-board-ux
tags:
  - ux
  - agent-board
  - kanban
---

# Agent Board drag-and-drop

## Problem

`AgentBoardRenderer.ts` has **zero drag handlers** — all lane transitions are button-driven
(Mark ready / Run / Stop / Accept / Rework). For a "kanban" board this violates the strongest user
expectation and makes the board feel unfinished.

## Proposed change

Add drag-and-drop between lanes that drives the same `TaskStateMachine` transitions the buttons use
(respecting transition rules — invalid drops rejected). Keyboard-accessible alternative is covered by the
`accessibility-pass` issue; this issue is the pointer DnD itself.

## Acceptance criteria

- Cards can be dragged between lanes; invalid transitions are rejected with feedback.
- Drag-drop uses the existing state-machine transition rules (no bypass).
- Buttons remain as an equivalent path.
