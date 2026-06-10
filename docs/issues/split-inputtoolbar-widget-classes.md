---
type: issue
id: issue-20260603-split-inputtoolbar
title: Split InputToolbar.ts (1419 LOC, 11 independent widget classes) into a toolbar/ directory
status: done
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-09
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (ARCH-3)"
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

## Resolution (2026-06-09)

Pure refactor; zero behavior change. By the time of the split the file had 9 widget classes
(OrchestratorToggle and QuickActionsToggle had already been removed), 1121 nonblank LOC.

Each widget moved into its own module under `src/features/chat/ui/toolbar/`:

| New module | Contents |
|---|---|
| `toolbar/shared.ts` | `runToolbarAction`, `formatTokens`, `ToolbarSettings`, `ToolbarCallbacks` |
| `toolbar/ModelSelector.ts` | `ModelSelector` |
| `toolbar/ModeSelector.ts` | `ModeSelector` |
| `toolbar/ThinkingBudgetSelector.ts` | `ThinkingBudgetSelector` |
| `toolbar/PermissionToggle.ts` | `PermissionToggle` |
| `toolbar/PlanModeToggle.ts` | `PlanModeToggle` |
| `toolbar/ServiceTierToggle.ts` | `ServiceTierToggle` |
| `toolbar/ExternalContextSelector.ts` | `ExternalContextSelector`, `AddExternalContextResult`, Electron dialog types |
| `toolbar/McpServerSelector.ts` | `McpServerSelector` |
| `toolbar/ContextUsageMeter.ts` | `ContextUsageMeter` |

`InputToolbar.ts` is now a thin barrel (re-exports every widget, `formatTokens`, and the toolbar
types) plus the `createInputToolbar` factory (59 nonblank LOC). No import sites or tests changed;
the `scripts/loc-baseline.json` allowlist entry for `InputToolbar.ts` was removed (baseline shrank).
Largest new module is `ExternalContextSelector.ts` at 316 nonblank LOC — all under the 500 LOC gate.
