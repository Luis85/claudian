---
type: issue
id: issue-20260603-split-inputtoolbar
title: Split InputToolbar.ts (1419 LOC, 11 independent widget classes) into a toolbar/ directory
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (ARCH-3)"
related:
  - "[[CLAUDE]]"
scope: chat-ui-refactor
tags:
  - architecture
  - refactor
  - chat
---

# Split InputToolbar.ts into per-widget modules

## Problem

`src/features/chat/ui/InputToolbar.ts` is 1419 LOC and exports **11 distinct widget classes** with no
shared state: `ModelSelector` (69), `ModeSelector` (160), `ThinkingBudgetSelector` (250),
`PermissionToggle` (391), `PlanModeToggle` (473), `OrchestratorToggle` (550), `QuickActionsToggle` (593),
`ServiceTierToggle` (624), `ExternalContextSelector` (693), `McpServerSelector` (1039),
`ContextUsageMeter` (1263). This is the strongest deletion-test pass in the tree — splitting genuinely
reduces because each widget is self-contained (~100–150 LOC).

## Proposed change

Move each class into its own module under `src/features/chat/ui/toolbar/`, keeping a thin barrel for
existing imports. No behavior change.

## Acceptance criteria

- Each widget lives in its own ~100–150 LOC module; `InputToolbar.ts` becomes a barrel/coordinator.
- No public import paths break (barrel re-exports).
- `typecheck && lint && test && build` green; relevant toolbar tests unchanged in behavior.
