---
type: issue
id: issue-20260603-long-chat-yield-tuning
title: Measure and tune the PERF-4 long-chat hydration yield constants on a real vault
status: open
priority: 3 - low
triage: needs-measurement
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (PR-4)"
related:
  - "[[docs/issues/Loading a long chat from history makes the ui unresponsive.md]]"
scope: history-hydration
tags:
  - performance
  - history
  - measurement
---

# PERF-4 yield-constant tuning (F2/F3)

## Problem

The PERF-4 long-chat hydration fix yields the event loop every `YIELD_EVERY_PARSED_LINES = 100` /
`YIELD_EVERY_MERGED_ENTRIES = 50`, but these constants were chosen without empirical input. Mocked-fs Jest
overstates the yield overhead ~75× because the dominant production I/O wait is mocked out. Per-frame
responsiveness holds; the total-load wall-clock grows with yield count.

## Evidence

- `src/providers/claude/history/sdkSessionPaths.ts:14`; `ClaudeHistoryStore.ts:64`.
- F2/F3 deferred per handoff `2026-06-04-q1-complete.md`.

## Proposed change

- **F3:** one production measurement on a real ≥1000-message vault (cold + warm OS cache), with and
  without yields. Capture in `.context/` (throwaway).
- **F2:** tune the two constants from the measured per-batch cost; update the rationale comments next to each.

## Acceptance criteria

- Constants reflect measured production data; comments record the per-batch cost + chosen N rationale.
- Per-frame responsiveness contract still holds.
