---
type: bug
priority: 1 - high
status: shipped
relations:
  - Performance
  - "[[Chat]]"
tags:
  - performance
  - chat
  - history
updated: 2026-06-03
---
When loading a long chat from history or having a long chat open and starting the plugin, the ui gets unresponsive while loading the chat.

## Root cause (2026-06-02 review)

Tracked as **PERF-4** in `docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md`. Distinct from the landed PERF-1 stream-time fix.

- `src/app/conversations/ConversationStore.ts:189-196` (`getConversationById`) → `hydrateConversationHistory()` → `src/providers/claude/history/ClaudeHistoryStore.ts:60-170` (`loadSDKSessionMessages`).
- Reads JSONL file, parses line-by-line, awaits subagent sidecar loads **sequentially** at `:144-163`.
- For a 500–1000 message conversation: 100–500ms of synchronous I/O + parsing **blocking the event loop** before any render.
- `MessageRenderer` correctly windows to 80 trailing messages (PERF-2 landed) — but the hydration cost happens before that window even mounts.

## Shipped

- **2026-06-03 — yielding parse** (commit `1e7a02e`). `loadSDKSessionMessages` now awaits a `setTimeout(0)` macrotask every 100 parsed lines (`sdkSessionPaths.ts:14` — `YIELD_EVERY_PARSED_LINES`) and every 50 merged entries (`ClaudeHistoryStore.ts:64` — `YIELD_EVERY_MERGED_ENTRIES`). Output is bit-for-bit identical (same messages, same order, same `skippedLines`).
- **2026-06-03 — perf gate** (commit `c9c5f03`). `tests/perf/conversationLoad.perf.test.ts` (PERF-8) covers the full disk → hydrate path at scales `[50, 200, 800, 2000]`, asserts message-count invariants (catches O(N²) duplication and silent drops), and reports `loadMs` for trend tracking. Per `jest.perf.config.js` timings are never asserted — the suite stays stable on noisy machines.
- **2026-06-03 — yield-above-continue** (Phase 1c F1). Merge-loop yield check moved above the three early-continue paths so cadence ties to raw iteration count regardless of skip-path clustering. Covered by the `yields during merge even when every entry hits a skip path` unit test in `tests/unit/utils/sdkSession.test.ts`.

## Trade-off (informational)

PERF-4 chose the yielding-parse shape over render-then-hydrate. Per-frame responsiveness is the contract that ships; total wall-clock grows with N because each yield is a macrotask round-trip. PERF-8's metrics table shows roughly +1.7 s wall-clock at N=4000 entries in mocked-fs Jest versus the no-yield baseline (~24 ms). Production fs I/O overlaps with the macrotask scheduler so the gap is expected to narrow significantly there; that measurement is tracked as Phase 1c F3.

The render-then-hydrate alternative — mount the windowed view with skeleton placeholders immediately and finalize through `StreamProjection` — is a better long-term shape (also subsumes PERF-5 and PERF-6) and is deferred to a separate spec until F3 confirms the wall-clock cost is user-visible on a real vault.

## Acceptance (reconciled — F4)

Original wording mixed two contracts. The shipped contract is per-frame:

- **Per-frame responsiveness (shipped):** Opening the longest conversation never blocks the event loop more than one animation frame (~16 ms) per yield window. PERF-4 yield constants chosen so each batch is well inside that budget.
- **Total load wall-clock (not asserted):** Grows roughly linearly with transcript length. Tracked via PERF-8's `loadMs` metric for trend visibility, not as a gate.
- **No regression in `conversationHistory.perf` or `claudeHistory.perf` suites.**

Phase 1c F2 (tune `YIELD_EVERY_PARSED_LINES` / `YIELD_EVERY_MERGED_ENTRIES` against measured production data) and F3 (one-off production measurement) refine the constants. If F3 shows the wall-clock cost is user-visible on a real vault, render-then-hydrate gets its own spec.
