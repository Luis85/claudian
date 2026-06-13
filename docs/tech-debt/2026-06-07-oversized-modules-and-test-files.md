---
type: tech-debt
title: "Oversized modules and test files exceed maintainable agent context"
date: 2026-06-07
updated: 2026-06-11
status: in-progress
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

1. ~~`InputToolbar.ts`: split independent widgets (`ModelSelector`, `ModeSelector`, `PermissionToggle`, `ExternalContextSelector`, `McpServerSelector`, `ContextUsageMeter`) into a toolbar directory. The current file has many independent classes and little shared state.~~ **Done 2026-06-09**: widgets now live one-per-module under `src/features/chat/ui/toolbar/`; `InputToolbar.ts` is a thin barrel + `createInputToolbar` factory. See [[split-inputtoolbar-widget-classes]].
2. `InputController.ts`: extract the resume dropdown and plan/approval state machine.
3. `CodexHistoryStore.ts`: split legacy, modern, and persisted parser families around shared turn state types.
4. `ClaudeChatRuntime.ts`: extract persistent-query lifecycle (`ensureReady`, `needsRestart`, response consumer startup) behind a smaller module interface.
5. For tests, split by behavior surface and reduce collaborator-call assertions in favor of interface-level outcomes.

## Acceptance criteria

- [x] New source files stay under the configured max-LOC gate unless explicitly allowlisted. — `npm run check:loc` ratchet, live since 2026-06-07.
- [x] Each split creates a deeper module with a small interface, not merely smaller files with the same shared mutable state.
- [x] Tests target the new interface and preserve behavior.
- [x] Existing cohesive owners are not split just to satisfy a number; the LOC rule includes a documented exception path. — per-entry `reason` in `scripts/loc-baseline.json`.

## Progress (2026-06-11, quality runs 1–5)

The 2026-06-07 hotspot table is largely retired; splits landed behind smaller
interfaces with behavior-preserving tests (fallow criticalComplexity 59 → 33
over the same runs):

- `ClaudeChatRuntime.ts` 1,665 → 1,636 with the query-turn family extracted to
  `claudeQueryTurnHelpers` (remediation item 4 — done).
- `CodexHistoryStore.ts` 1,406 → 940, split along the suggested seam into
  `codexTurnState` + `codexLegacyItemMapping` (item 3 — done).
- `InputController.ts`: `sendMessage` (457 lines) decomposed into
  `composerSendPhases` + private state-machine methods (item 2 — done for the
  send path; the resume dropdown remains in place).
- `InputToolbar.ts` split (item 1 — done 2026-06-09).
- `MessageRenderer.ts` shrank via `assistantMessageContent`;
  `CodexSessionFileTail`, `transformClaudeMessage`, `cursorStreamMapper`,
  `toolInputStreamState`, `sdkBranchFilter` all decomposed below thresholds.
- Settings tabs collapsed during the registry port: `OpencodeSettingsTab`
  671 → 73, `ClaudeSettingsTab` 448 → 173, `CodexSettingsTab` 447 → 214,
  `CursorSettingsTab` 326 → 33.

Remaining (status stays `in-progress`): 29 grandfathered source hotspots in
`scripts/loc-baseline.json` (shrink-only; largest `StreamController.ts`), and
remediation item 5 — the oversized **test** files (`Tab.test.ts` ~3.6k LOC,
`ClaudianService.test.ts` ~3.1k LOC) have not been split by behavior surface.

## Progress (2026-06-13, quality runs 6–13)

The source side shrank further and the baseline was re-locked to reality:

- Clone consolidation (runs 8, 11, 12b) and complexity decomposition (runs 9–10)
  extracted logic out of the grandfathered hotspots into smaller sibling modules,
  so many entries shrank again — e.g. `CodexHistoryStore` 940 → 746,
  `MessageRenderer` 1,208(recorded) → 1,061, `cursorToolNormalization` 572 → 542.
- Run 12a re-locked every grandfathered entry to current size
  (`check:loc --update`), so the count is now **27** (not 29) and each ceiling
  reflects reality — future growth is caught earlier.
- Eight source files still exceed 1,000 nonblank LOC (largest `ClaudeChatRuntime`
  1,599, then `StreamController` 1,514, `InputController` 1,404), all shrink-only.

Still open (keeps `in-progress`): remediation item 5 — the oversized **test**
files (`Tab.test.ts` is now ~4.5k LOC, `ClaudianService.test.ts` ~3.1k) remain
unsplit — and the eight >1,000-LOC source coordinators above. Splitting the test
files by behavior surface is the highest-value remaining slice here.
