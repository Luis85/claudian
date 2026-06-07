---
type: tech-debt
title: "Oversized modules and test files exceed maintainable agent context"
date: 2026-06-07
updated: 2026-06-07
status: open
priority: "1 - high"
severity: high
scope: module-depth
tags:
  - tech-debt
  - architecture
  - module-depth
  - maintainability
  - testing
related:
  - "[[split-oversized-coordination-files]]"
  - "[[2026-06-07-agentic-quality-gates]]"
  - "[[2026-06-03-comprehensive-improvement-proposal]]"
---

# Oversized modules and test files exceed maintainable agent context

## Summary

Many modules are too large for efficient review and agentic modification. Some are cohesive, but several pass the deletion test: deleting the module would spread ordering constraints and state-machine complexity across callers, which means the module is hiding real behavior and should be deepened behind a smaller interface.

## Evidence

Local LOC review on 2026-06-07:

- `src`: 522 tracked TypeScript files, ~84,048 nonblank LOC.
- `tests`: 496 tracked TypeScript files, ~118,548 nonblank LOC.
- `src` files above thresholds: 35 files >500 LOC, 18 >750 LOC, 12 >1,000 LOC, 2 >1,500 LOC.
- `tests` files above thresholds: 49 files >500 LOC, 19 >1,000 LOC.

Largest source hotspots:

| LOC | Module |
|---:|---|
| 1,665 | `src/providers/claude/runtime/ClaudeChatRuntime.ts` |
| 1,546 | `src/features/chat/controllers/StreamController.ts` |
| 1,406 | `src/providers/codex/history/CodexHistoryStore.ts` |
| 1,402 | `src/features/chat/controllers/InputController.ts` |
| 1,189 | `src/providers/opencode/runtime/OpencodeChatRuntime.ts` |
| 1,183 | `src/features/chat/rendering/MessageRenderer.ts` |
| 1,121 | `src/features/chat/ui/InputToolbar.ts` |
| 1,116 | `src/providers/codex/runtime/CodexChatRuntime.ts` |
| 1,097 | `src/features/chat/ClaudianView.ts` |
| 1,062 | `src/features/chat/rendering/ToolCallRenderer.ts` |

Largest test hotspots include `tests/unit/features/chat/tabs/Tab.test.ts` (3,682 LOC), `tests/unit/providers/claude/runtime/ClaudianService.test.ts` (3,115 LOC), and several controller suites above 2,000 LOC.

## Why it matters

Large files reduce locality: a change to one behavior forces the maintainer or agent to carry unrelated state, UI, provider, and test fixtures in context. The result is slower review, more accidental regressions, and test suites that assert wiring details instead of module behavior.

## Suggested remediation

Prioritize modules that pass the deletion test rather than splitting mechanically:

1. `InputToolbar.ts`: split independent widgets (`ModelSelector`, `ModeSelector`, `PermissionToggle`, `ExternalContextSelector`, `McpServerSelector`, `ContextUsageMeter`) into a toolbar directory. The current file has many independent classes and little shared state.
2. `InputController.ts`: extract the resume dropdown and plan/approval state machine.
3. `CodexHistoryStore.ts`: split legacy, modern, and persisted parser families around shared turn state types.
4. `ClaudeChatRuntime.ts`: extract persistent-query lifecycle (`ensureReady`, `needsRestart`, response consumer startup) behind a smaller module interface.
5. For tests, split by behavior surface and reduce collaborator-call assertions in favor of interface-level outcomes.

## Acceptance criteria

- [ ] New source files stay under the configured max-LOC gate unless explicitly allowlisted.
- [ ] Each split creates a deeper module with a small interface, not merely smaller files with the same shared mutable state.
- [ ] Tests target the new interface and preserve behavior.
- [ ] Existing cohesive owners are not split just to satisfy a number; the LOC rule includes a documented exception path.
