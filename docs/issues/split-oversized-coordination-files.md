---
type: issue
id: issue-20260603-split-oversized-coordination-files
title: Split the three oversized coordination files that pass the deletion test
status: open
priority: 2 - normal
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (ARCH-4)"
related:
  - "[[docs/adr/0001-transport-agnostic-provider-seam.md]]"
scope: refactor
tags:
  - architecture
  - refactor
  - tech-debt
---

# Split oversized coordination files (deletion-test-positive only)

## Problem

Three files >1400 LOC fuse genuinely separable seams and pass the deletion test:

- `src/features/chat/controllers/InputController.ts` (1482) — input wiring + instruction dispatch +
  approval/plan-approval state + resume dropdown + queue. Extractable: resume-dropdown
  (`showResumeDropdown`/`handleResumeKeydown`) and the plan-approval state machine.
- `src/providers/codex/history/CodexHistoryStore.ts` (1630) — ~40 free functions fusing legacy / modern /
  persisted parser families (`processLegacyItem`, `processPersistedPayload`, `processEventMsg`).
  Extractable into sibling modules sharing the `TurnState` types.
- `src/providers/claude/runtime/ClaudeChatRuntime.ts` (1864) — extractable: the persistent-query
  lifecycle (`ensureReady`/`closePersistentQuery`/`needsRestart`/`startResponseConsumer`).

## Proposed change

Split opportunistically, one file per PR. Pair the InputController split with the ADR-0001 Phase 2b
`RuntimeHost` churn to amortize test rewrites.

## Out of scope (deletion test FAILS — do NOT split)

`StreamController.ts`, `ToolCallRenderer.ts`, `TabManager.ts` — cohesive owners; splitting re-spreads
shared scroll/window/tab state.

## Acceptance criteria

- Each split leaves the plugin green (`typecheck && lint && test && build`) and changes no behavior.
- Extracted modules have focused, named responsibilities; no new cross-boundary imports.
