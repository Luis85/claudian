---
title: Implicit interaction-signal capture (rewind / retry / interrupt / copy)
date: 2026-06-22
status: draft
scope: features/chat, core/events, main.ts
parent: "[[docs/research/2026-06-22-brain-feature-research]]"
related:
  - "[[docs/superpowers/specs/2026-06-22-feedback-signal-capture-design]]"
---

# Implicit interaction-signal capture

## Problem

The Brain research (`docs/research/2026-06-22-brain-feature-research.md`, §5.8.3) found that
**implicit** signals are often *stronger* than the explicit thumb — GitHub's CACM 2024 study
showed suggestion acceptance predicted perceived productivity better than any explicit metric,
and Joachims (SIGIR 2005) showed implicit *relative* preferences are reliable where absolute
ratings are not. The research's reliability ranking for code:

> accept-and-apply (strongest +) > immediate **retry/regenerate** (strong −) > edit-then-keep
> (strong +, pair) > NL follow-up correction (strong −) > **rewind/undo** (− but ambiguous) >
> **copy** (weak +) > abandonment (noise).

Claudian already *performs* several of these interactions but captures none of them as signal:
rewind, fork, retry, stream-interrupt, and copy all flow through known chat seams and then
evaporate. This spec captures the **feasible-now** implicit signals into the same persisted
substrate as the thumbs feature, so the Brain has one unified signal stream to gate on.

This is the natural follow-up to
`docs/superpowers/specs/2026-06-22-feedback-signal-capture-design.md` (the explicit-thumb
capture). It is **capture only** — no distillation, retrieval, or optimization.

## Unify the substrate first (reconciliation with the thumbs spec)

The thumbs spec defined a narrow `FeedbackSignal { direction: 'up' | 'down' }` + a
`feedback:recorded` event + `.claudian/feedback.jsonl`. Rather than ship two parallel signal
pipes, **generalize to one** before either lands (neither has shipped, so there is no migration
cost):

```typescript
// src/features/chat/feedback/interactionSignalTypes.ts  (supersedes feedbackTypes.ts)
export type InteractionKind =
  | 'thumb-up' | 'thumb-down'   // explicit (from the thumbs spec)
  | 'rewind' | 'retry' | 'interrupt' | 'copy'; // implicit (this spec)

export type SignalPolarity = 'positive' | 'negative' | 'neutral';

export interface InteractionSignal {
  kind: InteractionKind;
  polarity: SignalPolarity;
  /**
   * 'high' for explicit/unambiguous (thumb, retry); 'low' for ambiguous implicit
   * (interrupt, copy). Consumers MUST weight by this — implicit signals are noisier.
   */
  confidence: 'high' | 'low';
  /** Correlated turn. For negative signals this is the turn being discarded/redone. */
  messageId: string;
  assistantMessageId?: string;     // provider checkpoint — survives reload/fork
  conversationId: string | null;
  providerId: ProviderId;
  at: string;                      // ISO-8601
  /** kind-specific extras, e.g. rewind { mode }. Kept small + content-free. */
  meta?: Record<string, string>;
}
```

The thumbs slice emits `kind: 'thumb-up' | 'thumb-down'` (polarity positive/negative,
confidence high). The store/event are renamed accordingly:

- `FeedbackSignalStore` → `InteractionSignalStore` (`.claudian/feedback.jsonl` filename kept).
- event `feedback:recorded` → `interaction:signal` carrying `InteractionSignal`.

If the thumbs spec is implemented first, do that under these generalized names; if this spec is
implemented first, it brings the substrate and the thumbs slice just adds two `kind`s.

## Goal

Capture, as `InteractionSignal` records + `interaction:signal` events, the implicit signals
that already flow through chat seams and can be captured **without new interaction UI**:

| Signal | Seam | Polarity / confidence | Correlated turn |
|--------|------|-----------------------|-----------------|
| **Rewind** (conversation-only) | `ConversationController.rewind(id, mode)` (`tabControllerSetup.ts:65`) | negative / **high** | the discarded assistant response to user msg `id` (`findRewindContext` → `prevAssistantUuid`) |
| **Rewind** (code-and-conversation) | same, `mode` distinguishes | negative / **high** (stronger — also reverts files) | same, `meta.mode='code-and-conversation'` |
| **Retry last turn** | `InputController.retryLastTurn()` (`InputController.ts:724`) | negative / **high** | the last assistant turn being redone |
| **Stream interrupt / cancel** | abort path in `StreamController`; persisted marker `message.isInterrupt` | negative / **low** (could mean "enough already") | the interrupted in-flight assistant message |
| **Copy response** | `wireCopyButton` success (`messageActionButtons.ts`) | positive / **low** (weak) | the copied assistant message |

Fork (`forkCallback`) is captured as **neutral / low** (a fork is exploration, not a verdict)
— recorded for completeness so the Brain can see branch points, but not treated as preference.

## Non-goals / deferred (with rationale)

- **Accept-and-apply** (the strongest positive per the research). In Claudian the agent applies
  changes itself via Write/Edit tools (`toolCall.status === 'completed'`); there is no discrete
  *user* "accept this suggestion" click in chat. The real positive signal is "an applied edit
  **survived** (was not reverted by a later code-rewind)" — a *derived, lagging* signal, not a
  capture-time event. **Deferred** to a Brain-side derivation that joins tool-completion with
  the absence of a subsequent `rewind` (kind `code-and-conversation`) on that turn.
- **Edit-then-keep preference pairs** (the gold signal). Requires editing the agent's output
  and measuring edit distance. Claudian has **no message-edit UI today** (the user message
  inbox doesn't support editing sent messages). **Deferred** until/unless an edit affordance
  exists; it would need its own capture spec.
- **NL follow-up correction** ("no, do X instead"). Semantic detection, not a deterministic
  seam. **Deferred** — too noisy/expensive for this slice.
- No optimization, distillation, retrieval, or Brain consumer. No new interaction UI. No
  message content stored (ids + kind + polarity + tiny `meta` only — same privacy stance as the
  thumbs spec).

## Architecture / data flow

```text
Existing interaction seam fires (rewind / retry / interrupt / copy / fork)
  -> recordInteractionSignal(plugin, { kind, polarity, confidence, messageId, ... })
       ├─ resolve providerId via plugin.getConversationSync(conversationId)?.providerId
       ├─ plugin.interactionSignalStore.record(signal)   // append .claudian/feedback.jsonl
       └─ plugin.events.emit('interaction:signal', signal)
```

Each capture is a **single added line** at the existing seam, alongside the real behavior — the
rewind/retry/interrupt/copy themselves are completely unchanged. As with the thumbs spec,
capture is a fire-and-forget side-channel: a store failure is caught + `debug`-logged and never
disturbs the interaction.

## Components / changes

| File | Change |
|------|--------|
| `src/features/chat/feedback/interactionSignalTypes.ts` | **New** (supersedes `feedbackTypes.ts`). `InteractionSignal`, `InteractionKind`, `SignalPolarity`. |
| `src/features/chat/feedback/InteractionSignalStore.ts` | **New/renamed** from `FeedbackSignalStore`. Append `.claudian/feedback.jsonl`; tolerant `readAll`; `latestByMessage()`; `signalsForMessage(id)`. Modeled on `RunSidecarStore`. |
| `src/features/chat/feedback/recordInteractionSignal.ts` | **New/renamed** from `recordFeedbackSignal`. Builds the signal, resolves `providerId`, appends + emits. Swallows + `debug`-logs store errors. |
| `src/features/chat/events.ts` | `'interaction:signal': InteractionSignal` on `ChatEventMap` (replacing the thumbs spec's `feedback:recorded`). |
| `src/features/chat/controllers/ConversationController.ts` (rewind) | In `rewind(id, mode)`, after the rewind resolves, call `recordInteractionSignal(...)` with `kind:'rewind'`, `polarity:'negative'`, `confidence:'high'`, `meta:{ mode }`, correlated to the discarded assistant turn via `findRewindContext`. |
| `src/features/chat/controllers/InputController.ts` (retry) | In `retryLastTurn()` (line 724), record `kind:'retry'` negative/high against the last assistant turn before the resend. |
| `src/features/chat/controllers/StreamController.ts` (interrupt) | On the user-initiated abort path (the same place `isInterrupt` is set), record `kind:'interrupt'` negative/low against the in-flight assistant message. Guard: only user-initiated aborts, not provider/runtime cancels. |
| `src/features/chat/rendering/messageActionButtons.ts` (copy) | In `wireCopyButton` on clipboard-write success, record `kind:'copy'` positive/low. |
| `src/features/chat/tabs/tabControllerSetup.ts` (fork) | In the `forkCallback` wiring (line 66), record `kind:'fork'`-as-neutral *(optional — include only if cheap; otherwise defer)*. |
| `src/main.ts` | Construct `this.interactionSignalStore = new InteractionSignalStore(this.app.vault.adapter);` beside `runSidecarStore`; declare the field. The thumbs `run` handlers (main.ts:233/243) now call `recordInteractionSignal` with `kind:'thumb-up'/'thumb-down'`. |

No `core/` change beyond the event-map type. Controllers reach `recordInteractionSignal`
directly (same layer); the store is an app-shell field like `RunSidecarStore`, so a future
Brain reads `plugin.interactionSignalStore`.

## Event contract

`interaction:signal` carries the full `InteractionSignal`, synchronous + error-isolated by the
existing `EventBus`. One event per captured interaction. Consumers MUST honor `confidence` and
treat implicit signals as *relative, weak priors* — never absolute truth (§5.8.5).

## Edge cases & failure modes

| Case | Handling |
|------|----------|
| Rewind ambiguity (could be exploration, not dissatisfaction) | `confidence` stays `high` for the *action* but consumers weight rewind below an explicit thumb-down; `code-and-conversation` (file revert) is the stronger negative — encoded in `meta.mode`. |
| Interrupt could mean "I have enough" not "this is wrong" | `confidence:'low'`; never gate a "do/avoid" lesson on interrupt alone. |
| Retry fires multiple times on a flaky turn | Append each; `signalsForMessage` exposes the count, which is itself signal. |
| Double signals on one turn (copy then rewind) | Both stored; the Brain reconciles by polarity + recency. Contradiction is information, not a bug. |
| Provider/runtime-initiated abort vs user cancel | Only record user-initiated interrupts; gate on the same condition that sets `isInterrupt` for a user action. |
| Rewind discards the very turn being correlated | Correlate to the discarded assistant id captured *before* truncation; if unresolvable, fall back to the user message id + `meta`. |
| Capture throws | Caught + `debug`-logged via `plugin.logger.scope('signals')`; the interaction proceeds. |

## TDD test plan (mirrored under `tests/`)

1. `InteractionSignalStore.test.ts` — append/round-trip; CRLF + corrupt-line tolerance; `[]`
   when missing; `latestByMessage` last-wins; `signalsForMessage` returns all for one id.
2. `recordInteractionSignal.test.ts` — emits `interaction:signal` with correct
   kind/polarity/confidence/meta; resolves `providerId`; swallows store rejection.
3. Per-seam unit tests asserting the seam records the right signal **without changing existing
   behavior**: rewind (both modes → `meta.mode`), retry, interrupt (user-abort only), copy.
   Each extends the existing controller/renderer test file rather than adding a parallel one.

Write the store test first, then `recordInteractionSignal`, then wire one seam at a time
(rewind → retry → interrupt → copy), keeping every existing chat test green. Run
`npm run typecheck && npm run lint && npm run test && npm run build` per seam.

## Quality gates

- LOC ratchet: small new files + one line per seam; within budget.
- Perf: each capture is an O(1) append off the interaction path; no consumer reads on a hot
  path yet (the Brain will add its own `perf` guard when it consumes the store).
- Lint: no `innerHTML`/`console.*`; log via `plugin.logger.scope('signals')`.

## Guardrails carried forward (constraints on future consumers, not this slice)

From §5.8.5 — restated so the capture layer is never mistaken for a learning layer:

- **Never optimize** for any of these signals (sycophancy + feedback-gaming risk).
- **Weight by `confidence`**; implicit signals are noisy — use as *relative* priors, prefer
  pairwise/temporal over absolute counts (Joachims).
- **Require a co-verifying signal** before a negative signal hardens into an "avoid this"
  lesson (e.g. rewind **and** a `runtime_error`/failed test on that turn).
- Keep everything a transparent, deletable vault file (Cursor Memories→Rules lesson).

## Open questions

1. Include `fork` as a neutral signal now, or defer? (Lean defer — low value, avoids noise.)
2. Should `accept-and-apply` be derived Brain-side from "tool completed + not later reverted",
   or wait for an explicit accept affordance? (Lean derive Brain-side; cheap and high-value.)
3. Worth a tiny `signalsForMessage` → button "selected"/"rated" state later? (Defer; non-goal.)
