---
type: issue
id: issue-20260603-streaming-render-cost
title: Document streaming render as O(C)/tick (throttled); delta-append only if jank is reported
status: open
priority: 3 - low
triage: low-value
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (PR-3)"
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
