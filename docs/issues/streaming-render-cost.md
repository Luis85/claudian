---
type: issue
id: issue-20260603-streaming-render-cost
title: Document streaming render as O(C)/tick (throttled); delta-append only if jank is reported
status: done
priority: 3 - low
triage: low-value
created: 2026-06-03
updated: 2026-06-09
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (PR-3)"
scope: streaming-render
tags:
  - performance
  - streaming
  - docs
---

# Streaming render cost (document, optional optimization)

## Problem

Streaming text render re-parses the **entire** accumulated block on each tick via
`MarkdownRenderer.renderContent(textEl, currentTextContent)` — O(C)/tick, not a delta append. PERF-3's
size-aware backoff caps the *rate*, so it is bounded in practice, but a single very large streamed block
still pays a full re-parse on every throttled tick. The current docs mis-describe this as O(1)/chunk.

## Evidence

- `src/features/chat/controllers/StreamController.ts:823-838` (`renderPendingText`), `:870-879`,
  `:893-916` (same pattern for tool output).

## Proposed change

- Correct the documentation/comments to state O(C)/tick (throttled).
- Only pursue a delta-append renderer (L) if users report jank on very long single answers.

## Acceptance criteria

- Docs/comments reflect the actual cost model. (Code change deferred unless jank is reported.)

## Resolution (2026-06-09)

Documentation corrected; no behavior change. The `StreamController` comments now
state the real cost model explicitly: streaming render is a **full re-parse of
the accumulated block on each throttled tick — O(C)/tick (O(C²) cumulative), not
an O(1) delta append** — bounded in practice by the PERF-3 size-aware backoff
(`STREAM_REPARSE_BACKOFF_THRESHOLD_CHARS` / `STREAM_REPARSE_BACKOFF_MS`), with
the final render flushed exactly on finalize. Updated comments: the PERF-3
backoff-constant note, `renderPendingText`, and the `scheduleStreamContinuation`
JSDoc (the tool-output path comment already described the same backoff). The
cited line numbers (823-838, 870-879, 893-916) had drifted; the misleading
O(1)-style claims they pointed at no longer exist in the file, and the remaining
`O(1)` comments there refer to the tool-call lookup index, which is genuinely
O(1).

Remaining `O(1)/chunk` phrasing in `docs/` lives only in dated historical review
snapshots (`docs/reviews/2026-05-31-…`, `docs/reviews/2026-06-02-…`), describing
PERF-1 scroll/reflow; the 2026-06-03 review already corrects the record
(`docs/reviews/2026-06-03-comprehensive-improvement-proposal.md`). Those
snapshots are left as-is.

A delta-append renderer remains **deliberately deferred** until users report
jank on very long single streamed answers.
