---
title: Feedback signal capture (thumbs up/down → structured, persisted signal)
date: 2026-06-22
status: draft
scope: features/chat/feedback, core/events, main.ts, app storage
parent: "[[docs/research/2026-06-22-brain-feature-research]]"
related:
  - "[[docs/superpowers/specs/2026-06-04-thumbs-feedback-actions-design]]"
---

# Feedback signal capture

## Problem

The chat panel already has per-response **thumbs up/down** buttons, but the click is
**ephemeral**: `sendFeedbackPrompt` dispatches an i18n prompt as a normal user turn and
records *nothing* on the rated message ("No persistence on the rated message" —
`src/features/chat/feedback/sendFeedbackPrompt.ts:13`). The signal survives only as buried
conversational text, not a structured, queryable rating.

The Brain research (`docs/research/2026-06-22-brain-feature-research.md`, §5.8) found that a
human thumb — plus implicit accept/edit/retry/rewind signals — is precisely the **external
verifier** a self-improving memory loop needs: the strongest distillation systems (ExpeL,
ReasoningBank) self-judge success/failure with an LLM, which *is* the self-conditioning
failure mode the rest of the research warns against. A persisted human signal replaces that
self-judge at the write gate. None of that is possible while the signal is thrown away.

This spec covers the **smallest independently-useful increment**: capture the thumbs signal
as a structured, persisted, turn-correlatable record, plus an event other features can
subscribe to. It is the unblock-everything step from §5.8.7. It deliberately does **not**
build the Brain, distillation, retrieval, or any consumer of the signal.

## Goal

When the user clicks thumbs up/down on an assistant response:

1. Append a structured `FeedbackSignal` record to an append-only vault store
   (`.claudian/feedback.jsonl`), correlatable back to the rated turn by message id.
2. Emit a typed `feedback:recorded` event on the existing `EventBus` so future consumers
   (a Brain service, a local review UI) can react without polling the file.
3. Keep the current conversational behavior exactly as-is — the prompt-as-turn nudge still
   fires; capture is an additive side-channel.

## Non-goals (explicitly out of scope)

- **No Brain, no distillation, no retrieval, no lesson generation.** This is capture only.
- **No optimization over feedback.** The store is passive. Per §5.8.5, feedback must never
  become a training/optimization target (sycophancy + feedback-gaming risk). No gradient, no
  reward maximization, no auto-tuning anywhere in this slice.
- **No message content stored.** Only ids + direction + timestamp. The transcript is already
  persisted by the provider and recoverable via `messageId`; storing the body here would be
  redundant and a privacy regression. This is a deliberate privacy-positive choice.
- **No implicit signals yet** (accept/edit/retry/rewind). They are higher-value (§5.8.3) but
  need their own capture seams; this slice ships the one signal that already has a button.
- **No UI changes** — no "selected" state on the buttons, no review panel. (A `selected`
  state could follow once the latest-per-message read exists; flagged as a future step.)
- **No settings/feature-flag gate.** Capture is local, content-free, and low-risk; gating is
  unnecessary. (If product wants an opt-out, it is a one-line `isEligible`/settings check
  later.)

## Data shape

```typescript
// src/features/chat/feedback/feedbackTypes.ts  (new)
export interface FeedbackSignal {
  /** Rated assistant message id (ChatMessage.id). Primary correlation key. */
  messageId: string;
  /** Provider-native checkpoint id when present — survives history reload/fork. */
  assistantMessageId?: string;
  conversationId: string | null;
  providerId: ProviderId;
  direction: 'up' | 'down';        // reuse FeedbackDirection from sendFeedbackPrompt
  /** ISO-8601 capture time. */
  at: string;
}
```

Append-only is intentional: a user clicking up-then-down (or re-rating) is itself signal
(the research valued *relative/temporal* preference over absolute counts — Joachims). Readers
that want "current rating" use `latestByMessage()` (last entry wins per `messageId`); readers
that want the flip-flop history read the raw log.

## Architecture / data flow

```text
User clicks thumbs icon
  -> main.ts ChatMessageAction.run(msg, conversationId)
     ├─ sendFeedbackPrompt(this, msg, conversationId, direction)   // UNCHANGED — dispatch nudge
     └─ recordFeedbackSignal(this, msg, conversationId, direction) // NEW — capture side-channel
          ├─ resolve providerId via plugin.getConversationSync(conversationId)?.providerId
          ├─ plugin.feedbackSignalStore.record(signal)   // append .claudian/feedback.jsonl
          └─ plugin.events.emit('feedback:recorded', signal)
```

`sendFeedbackPrompt` stays pure (its existing tests are untouched). Capture is a sibling call
so dispatch and persistence are independently testable and a failure in one never breaks the
other. Both run handlers (main.ts:233, main.ts:243) gain the one extra call.

## Components

| File | Change |
|------|--------|
| `src/features/chat/feedback/feedbackTypes.ts` | **New.** `FeedbackSignal` interface (above). Re-export/align `FeedbackDirection`. |
| `src/features/chat/feedback/FeedbackSignalStore.ts` | **New.** Modeled on `features/tasks/storage/RunSidecarStore`. `constructor(adapter: DataAdapter, filePath = '.claudian/feedback.jsonl')`. Methods: `record(signal)` (memoized `ensureBaseDir` walk of `.claudian`, then `adapter.append(path, JSON.stringify(signal)+'\n')`); `readAll()` (tolerates CRLF, skips corrupt lines, `[]` when missing — mirror `readLedger`); `latestByMessage(): Map<string, FeedbackSignal>` (last-wins per `messageId`). Filesystem-only, no business logic. |
| `src/features/chat/feedback/recordFeedbackSignal.ts` | **New.** `recordFeedbackSignal(plugin, message, conversationId, direction): void`. Builds the signal (resolves `providerId` via `plugin.getConversationSync`), fires `void plugin.feedbackSignalStore.record(signal).catch(log)` and `plugin.events.emit('feedback:recorded', signal)`. Swallows + `debug`-logs store errors (capture must never throw into the click handler). |
| `src/features/chat/events.ts` | Add `'feedback:recorded': FeedbackSignal` to `ChatEventMap` (chat-originated; mirrors `conversation:renamed`). Import the type. *(Alternative: a dedicated `FeedbackEventMap` `&`-ed into `ClaudianEventMap` if a feedback slice grows; ChatEventMap is the minimal diff today.)* |
| `src/main.ts` | (1) Construct the store in `onload` beside `runSidecarStore` (main.ts:156): `this.feedbackSignalStore = new FeedbackSignalStore(this.app.vault.adapter);`. (2) Declare the `readonly feedbackSignalStore` field. (3) Add `recordFeedbackSignal(this, msg, conversationId, 'up'/'down');` in the two existing `run` handlers (main.ts:233, 243), right after the `sendFeedbackPrompt` call. |

No `core/` change beyond the event-map type. The store lives in the feature slice (co-located
with `sendFeedbackPrompt`) and is constructed at the app shell exactly like `RunSidecarStore`,
so a future app-shell Brain service can read `plugin.feedbackSignalStore` directly.

## Event contract

`feedback:recorded` carries the full `FeedbackSignal`. Synchronous, error-isolated (the
`EventBus` already isolates subscriber throws via its error sink), emitted *after* the store
append is dispatched. Consumers must treat it as fire-and-forget and never block the click.

## Storage & privacy

- Path: `.claudian/feedback.jsonl`, one JSON-encoded `FeedbackSignal` per line.
- Content-free by design (ids + direction + time only) → no secret-redaction surface, no PII,
  nothing that needs `SecretStorage`. The transcript stays the single source of truth.
- Append-only; no in-place rewrite, so no write-race with anything. Reads tolerate partial
  last lines, CRLF, and corrupt lines (mirror `RunSidecarStore.readLedger`).
- Lives in the vault → user-inspectable, git-diffable, deletable — consistent with the
  research's transparency stance and the Cursor-Memories→Rules lesson (§5.8.5).

## Edge cases & failure modes

| Case | Handling |
|------|----------|
| Rapid double-click / re-rating / up-then-down | Append each — temporal history is signal. `latestByMessage` resolves "current". |
| `conversationId === null` (active-tab fallback path) | Store `conversationId: null`; still keyed by `messageId`. |
| `getConversationSync` returns nothing (race) | `providerId` falls back to the active conversation's provider, else a typed `'unknown'`-guarded skip — never throw. |
| `.claudian` missing on a fresh vault | `ensureBaseDir` segment-walk + EEXIST tolerance, copied from `RunSidecarStore`. |
| Adapter append fails | Caught, `debug`-logged via `plugin.logger.scope('feedback')`; the nudge turn already fired, so the UX is unaffected. |
| History reload changes `ChatMessage.id` | Persist `assistantMessageId` too (provider checkpoint) so correlation survives reload/fork. |

## TDD test plan (mirrored under `tests/`)

1. `tests/unit/features/chat/feedback/FeedbackSignalStore.test.ts` — `record` appends a parseable
   line; `readAll` round-trips, tolerates CRLF + a corrupt line, returns `[]` when the file is
   absent; `latestByMessage` returns the last entry per `messageId`; concurrent first-writes
   don't double-`mkdir` (reuse the `RunSidecarStore` memoization assertion).
2. `tests/unit/features/chat/feedback/recordFeedbackSignal.test.ts` — emits `feedback:recorded`
   with the correct payload (incl. resolved `providerId` and `assistantMessageId`); calls
   `store.record`; swallows + logs a store rejection without throwing; tolerates `null`
   conversationId.
3. Existing `tests/unit/features/chat/feedback/sendFeedbackPrompt.test.ts` stays green (capture
   is additive; dispatch is unchanged).

Write the failing `FeedbackSignalStore` test first, then `recordFeedbackSignal`, then wire
`main.ts`. Run `npm run typecheck && npm run lint && npm run test && npm run build`.

## Quality gates

- LOC ratchet: three small new files + ~5 lines in `main.ts`/`events.ts`; within budget.
- No perf-suite change: `record` is O(1) append; `readAll`/`latestByMessage` are not on any
  hot render path (no consumer yet). If a future Brain reads this on every turn, add a
  `feedbackSignal.perf` guard then.
- Lint: no `innerHTML`, no `console.*` (use `plugin.logger.scope('feedback')`); build DOM-free.

## What this unblocks (and explicitly defers)

With the signal persisted and `feedback:recorded` flowing, every §5.8 concept becomes
buildable in later, separately-specced slices:

- **Feedback-gated lesson distillation** (top concept): a Brain service subscribes to
  `feedback:recorded`, joins it with objective co-signals (tool status / `runtime_error` /
  kept code), and only then distills a "do/avoid" lesson — the human label gating the write.
- **Chosen/rejected preference pairs**, **feedback-weighted retrieval**, **per-step relevance
  gating** — all consume the same store.

None of those ship here. The guardrails from §5.8.5 (thumb = eligibility not truth; require a
co-verifying signal; never optimize for the thumb; keep lessons transparent + editable) are
**constraints on those future consumers**, recorded here so the capture layer is never
mistaken for a learning layer.

## Open questions

1. Do we want a minimal "selected" visual state on the buttons once `latestByMessage` exists?
   (Low effort; deferred — non-goal here.)
2. Should the store eventually move to an app-shell `app/` location alongside
   `SharedStorageService` when the Brain service lands, or stay in the feature slice? (Either
   works; defer until the Brain service exists.)
3. Capture implicit signals (rewind = strong negative; retry; accept-and-apply) next — each is
   a separate small capture spec following this template.
