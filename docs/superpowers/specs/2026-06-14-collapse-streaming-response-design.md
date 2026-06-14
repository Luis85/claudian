---
title: Collapse streaming response until complete
date: 2026-06-14
status: draft
scope: chat/controllers, chat/rendering, settings, i18n, core/types
---

# Collapse streaming response until complete

## Problem

While the agent streams an answer, `StreamController` re-parses the entire
accumulated text block on every throttled tick (`renderPendingText` →
`MessageRenderer.renderContent` → `MarkdownRenderer.render`). Partial markdown
and partial tag/XML content therefore render in a half-formed state and only
settle when the block finalizes:

- Half-streamed markdown (unclosed code fences, tables, bold/links) flickers
  and re-flows as more tokens arrive.
- Tag-like content looks broken mid-stream. In work-order tabs the
  `<claudian_progress>` / `<claudian_needs_input>` / `<claudian_needs_approval>`
  / `<claudian_handoff>` blocks are only transformed into cards at finalize
  (`MessageRenderer.finalizeStreamedAssistantText` →
  `splitWorkOrderProtocolForDisplay`), so the raw opening tag and its partial
  body show as literal text until the closing tag arrives.

The user wants the in-progress answer hidden behind a lightweight
"writing…" placeholder and rendered as a whole once it completes, so the chat
never shows an incomplete/broken intermediate state.

## Decisions

| # | Decision | Chosen | Rejected |
|---|----------|--------|----------|
| 1 | Scope of deferral | Collapse **all** streaming answer text behind a placeholder | Only collapse when an unclosed special/XML block is detected; stream as raw unparsed text |
| 2 | Rollout | New setting `collapseStreamingResponse`, **default on** | Default off (opt-in); always on with no setting |
| 3 | Placeholder | Reuse the existing streaming indicator (`showThinkingIndicator`) with a stable "Writing response…" label + the current `esc to interrupt · mm:ss` timer | New dedicated placeholder component with its own timer/cleanup; off-DOM detached render node |
| 4 | Granularity | Defer per **text block** — render fully when the block completes (model transitions to a tool/thinking/other block, or the turn ends) | Buffer the entire turn and render only at `done` |
| 5 | Thinking/reasoning blocks | Keep streaming as today (already collapsed behind a toggle; not a source of the broken-XML look) | Also defer thinking-block rendering |
| 6 | Tools / diffs / subagents | Unchanged — keep rendering live | Defer these too |

## Behavior

When `collapseStreamingResponse` is **on** (default):

- While an answer text block streams, the chat shows the existing streaming
  indicator relabeled **"Writing response…"**, keeping the current
  `esc to interrupt · mm:ss` timer, instead of live-rendering partial markdown.
- The fully-parsed result — including the work-order `<claudian_*>` card
  transform — appears in **one pass** when the block completes.
- Deferral is **per text block**. A block completes when the model switches to a
  tool / thinking / another block, or the turn ends (`done`). So a turn shaped
  like `text → tool → text` renders each text segment fully at its boundary;
  tools, diffs, and subagents keep rendering live as they do today. For a plain
  prose answer with no tool boundary, this is a single clean render at the end.

When `collapseStreamingResponse` is **off**, streaming is the current
token-by-token behavior, unchanged.

Out of scope: thinking/reasoning blocks continue to stream into their collapsed
block as today.

## Architecture

The change is localized to `StreamController`'s text-block path plus setting
wiring. No changes to persistence (`contentBlocks`), history reload, scroll, or
any renderer other than timing.

### `StreamController`

- `shouldCollapseStreamingResponse(): boolean` — reads the setting with
  default-on semantics (`settings.collapseStreamingResponse !== false`),
  mirroring the existing `shouldDeferMathRendering()`.
- `appendText(text)`: in collapse mode, accumulate `state.currentTextContent`
  into an empty `currentTextEl` (created as today so the open-text-block state
  machine and `finalize` are unchanged), **skip** `scheduleCurrentTextRender`,
  and keep the "Writing response…" indicator visible (do **not**
  `hideThinkingIndicator`). `msg.content` accumulation in `routeContentChunk`
  is unchanged.
- `finalizeCurrentTextBlock(msg)`: in collapse mode, render the accumulated
  content **once** into `currentTextEl` (unconditionally, since streaming
  rendered nothing), hide the indicator, then run the existing card-swap
  (`finalizeStreamedAssistantText`) + copy-button + content-block-persist path
  unchanged. In normal mode, the method behaves exactly as today (the streamed
  element already holds content; finalize only fixes deferred math, swaps the
  card, and adds the copy button).

### Placeholder label

Reuse `showThinkingIndicator(overrideText, overrideCls)`. While answer text is
actively streaming in collapse mode, show it with a stable "Writing response…"
label (i18n key) rather than the random `FLAVOR_TEXTS`, keeping the existing
`esc to interrupt · mm:ss` timer. The indicator is the same DOM element and
cleanup path already used between tool calls.

### Setting wiring

- `src/core/types/settings.ts` — add `collapseStreamingResponse: boolean`.
- `src/app/settings/defaultSettings.ts` — `collapseStreamingResponse: true`.
- `src/features/settings/registry/fields/general.ts` — add a toggle next to
  `deferMathRenderingDuringStreaming`.
- `src/features/settings/ClaudianSettings.ts` — legacy imperative toggle (kept
  until the v4.0.0 deletion pass, per repo convention).
- i18n — add `settings.collapseStreamingResponse.name` / `.desc` to
  `src/i18n/types.ts` and the locale files (`en.json` real copy; other locales
  fall back to English text and can be translated later).

## Data flow

```text
text chunk
  -> routeContentChunk: msg.content += chunk.content   (unchanged)
  -> appendText(chunk.content)
       collapse on : accumulate into empty currentTextEl, keep "Writing response…" indicator, no live render
       collapse off: existing token-by-token scheduleCurrentTextRender
block boundary / done
  -> finalizeCurrentTextBlock(msg)
       collapse on : render full content once -> hide indicator -> card-swap + copy button + persist block
       collapse off: existing finalize (math fix + card-swap + copy button + persist block)
```

## Testing

- `tests/unit/features/chat/controllers/StreamController.test.ts`
  - setting **on**: streaming `text` chunks do **not** render into the text
    block mid-stream (`renderContent` is not called for the block until
    finalize); the indicator stays visible; on `done` (or a block transition)
    `renderContent` is called once with the full accumulated content; the
    persisted `contentBlocks` entry is identical to the non-collapsed path.
  - setting **off**: streaming render still fires during streaming (no
    regression).
- `tests/integration/settings/*` parity (e.g. `generalPort.test.ts`,
  `search.test.ts`): include the new setting key so registry/legacy parity and
  search coverage stay complete.
- Existing perf specs (`multiTabStreaming.perf`, `messageRenderer.perf`) stay
  green; collapse mode additionally removes the O(C²) streaming re-parse for
  text (consistent with the PERF-3 note in `StreamController`).

## Risks / edge cases

- **Long single answer, no tool boundary:** the user sees only the placeholder
  until `done`. This is the intended trade-off of "all streaming text" +
  default-on; the live timer keeps it from feeling frozen, and the toggle lets
  users opt back into token-by-token streaming.
- **Interaction with `deferMathRenderingDuringStreaming`:** moot during
  streaming (nothing renders); the single final render is exact, so there is no
  conflict.
- **Work-order tabs:** the `<claudian_*>` card transform already runs at
  finalize via `finalizeStreamedAssistantText`; deferring the streaming render
  does not change it — it just removes the broken-looking partial-tag phase.
- **Cancel / interrupt mid-stream:** `resetStreamingState` already hides the
  indicator and clears text state; the partial `msg.content` is preserved for
  the interrupt marker path as today.
