---
type: bug
priority: 1 - high
status: open
relations:
  - Performance
  - "[[Chat]]"
tags:
  - performance
  - chat
  - history
updated: 2026-06-02
---
When loading a long chat from history or having a long chat open and starting the plugin, the ui gets unresponsive while loading the chat.

## Root cause (2026-06-02 review)

Tracked as **PERF-4** in `docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md`. Distinct from the landed PERF-1 stream-time fix.

- `src/app/conversations/ConversationStore.ts:189-196` (`getConversationById`) → `hydrateConversationHistory()` → `src/providers/claude/history/ClaudeHistoryStore.ts:60-170` (`loadSDKSessionMessages`).
- Reads JSONL file, parses line-by-line, awaits subagent sidecar loads **sequentially** at `:144-163`.
- For a 500–1000 message conversation: 100–500ms of synchronous I/O + parsing **blocking the event loop** before any render.
- `MessageRenderer` correctly windows to 80 trailing messages (PERF-2 landed) — but the hydration cost happens before that window even mounts.

## Fix sketch

Two compatible options (pick one):

1. **Yielding parse** — chunk the JSONL read, `await new Promise(r => setTimeout(r, 0))` between chunks so the event loop runs.
2. **Render-then-hydrate** — mount the windowed view immediately with skeleton placeholders; complete hydration in the background; finalize via the existing `StreamProjection` applier. Better long-term shape; also covers PERF-5 (sidecar loop) and PERF-6 (dedupe-after-merge).

## Test gate

Add `tests/perf/conversationLoad.perf.test.ts` (PERF-8) asserting cold-load latency scales linearly with message count and a worst-case bound. The existing perf suite covers parsing/filtering but not the full disk → hydrate → render path — that gap masked this symptom.

## Acceptance

- Opening the longest conversation in a representative vault is interactive within 1 animation frame (~16ms).
- New perf gate green.
- No regression in the existing `conversationHistory.perf` / `claudeHistory.perf` suites.
