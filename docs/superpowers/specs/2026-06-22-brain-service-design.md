---
title: Brain service (consume signals → distill lessons → re-inject)
date: 2026-06-22
status: draft
scope: app/brain, core/events, core/auxiliary, core/prompt, core/context, features/settings, main.ts
parent: "[[docs/research/2026-06-22-brain-feature-research]]"
related:
  - "[[docs/superpowers/specs/2026-06-22-feedback-signal-capture-design]]"
  - "[[docs/superpowers/specs/2026-06-22-implicit-interaction-signal-capture-design]]"
  - "[[docs/superpowers/specs/2026-06-22-brain-scheduler-and-publishing-design]]"
---

# Brain service

## Problem

The two capture specs persist explicit + implicit outcome signals
(`.claudian/feedback.jsonl`, `interaction:signal`) but nothing *consumes* them. The Brain
research (`docs/research/2026-06-22-brain-feature-research.md`) recommends a **local,
vault-native, provider-neutral** service that turns outcome-gated session signals into
**reviewable markdown lessons** and re-injects the relevant ones into future turns — the
capability §2.3 found is essentially absent from installable Obsidian plugins.

This spec defines that service. It is the consumer the capture specs feed. It is scoped to a
**buildable MVP** (manual "Consolidate & Recall" + a gated background distiller behind a
feature flag, off by default), with v1/v2 explicitly deferred. The research's load-bearing
constraints are non-negotiable here: **external verification at the write gate; never optimize
for feedback; append-only itemized lessons (no LLM rewrite); transparent, deletable markdown.**

## Goal (MVP)

A `BrainService` at the app shell that:

1. **Observes** completed turns and their signals (new `conversation:turn-completed` event +
   `interaction:signal` + `task:run-finished`).
2. **Gates** which turns are eligible to become lessons, using the human/implicit signal **plus
   an objective co-signal** (tool status / `runtime_error` / task `verification`).
3. **Distills** eligible turns into itemized candidate lessons via a provider-neutral,
   model-routed query service (the `QueryBacked*` + `AuxQueryRunner` pattern title-generation
   already uses).
4. **Stages** candidates for **propose→approve** review — nothing reaches the durable store
   without the user accepting/editing it.
5. **Persists** approved lessons as ACE-style itemized, append-only **markdown** in the vault.
6. **Re-injects** relevant lessons into future turns via the existing trust-tagged
   `ContextEnvelope` seam — manual "Prime from Brain" in MVP.

All **off by default**, behind a feature flag + first-run consent.

## Non-goals (deferred to v1/v2)

- **No always-on / continuous auto-watching.** MVP is manual consolidation + an opt-in gated
  background suggestion; not a silent learner.
- **No embeddings / vector DB.** MVP retrieval is lexical + helpful-count ranking over markdown.
  A derived local index (sqlite-vec) is a v1 add, rebuildable from the markdown.
- **No auto-injection into every turn.** MVP is a manual "Prime from Brain" command; gated
  auto-injection is v1.
- **No skill promotion, cross-project meta-patterns, graph participation, or outcome feedback
  loop.** All v2 (research §7).
- **No fine-tuning, no RL, no optimization over feedback** — ever (sycophancy/gaming, §5.8.5).
- **No new provider runtime.** The Brain is provider-neutral and never touches `providerState`.

## Prerequisite: `conversation:turn-completed` event

Ad-hoc chat has no turn-completion event today (only Tasks does). Add one at the
`ConversationStore` save seam — the deps already carry `events` and the comment explicitly
anticipates "future store-owned events" (`ConversationStore.ts:29-35`).

```typescript
// ChatEventMap (src/features/chat/events.ts)
'conversation:turn-completed': {
  conversationId: string;
  providerId: ProviderId;
  assistantMessageId?: string;   // provider checkpoint
  at: number;                    // the advancing lastResponseAt
};
```

Emit it in `ConversationStore` when a save advances `lastResponseAt` (a completed assistant
turn), guarded to once per turn boundary (compare against the prior persisted `lastResponseAt`
so renames/other saves at lines 191/213 don't re-fire it). This event is independently useful
and is the single prerequisite that unblocks ad-hoc-chat learning.

## Architecture

```text
                ┌────────────── EventBus (plugin.events) ──────────────┐
                │  interaction:signal   conversation:turn-completed     │
                │  task:run-finished                                    │
                └───────────────┬───────────────────────────────────────┘
                                ▼
                         BrainService (app/brain)            [off by default; consented]
        observe ──▶  OutcomeGate  ──eligible──▶  LessonDistiller (QueryBacked + AuxQueryRunner)
                       │  joins: signals (interactionSignalStore)            │ candidates
                       │         tool status / runtime_error (messages)      ▼
                       │         task verification (handoff)            PendingLessons (staged)
                       │                                                     │ user approves/edits
                       ▼                                                     ▼
                 (skip if neutral / low-confidence only)            BrainLessonStore  (visible Brain/*.md)
                                                                     append-delta, counters, decay
                                                                           │ retrieve (relevance + helpful-count, budgeted)
                                                                           ▼
   new turn ──▶ buildContextEnvelope() gains a trust-tagged "brain" ContextSource ──▶ all 4 provider encoders
```

The Brain lives in `src/app/brain/` (app shell composes features + core), subscribes to the
bus, and never imports provider internals. Its only injection touch-point is a new
`ContextSource` in the shared `buildContextEnvelope` — which all four turn encoders already
render — so injection is provider-neutral with no per-provider prompt-builder changes.

## Components

| File | Purpose |
|------|---------|
| `src/features/chat/events.ts` + `src/app/conversations/ConversationStore.ts` | Add + emit `conversation:turn-completed` (prerequisite above). |
| `src/app/brain/BrainService.ts` | **New.** App-shell orchestrator. Constructed in `onload` (gated by `settings.brain.enabled`). Subscribes to the three events; owns the gate, distiller handoff, pending queue, store, and retrieval. Disposable (unsubscribe on unload). |
| `src/app/brain/OutcomeGate.ts` | **New.** Pure function: given a turn's signals + tool/runtime outcome + optional task verification, returns `{ eligible, polarity, reason }`. Encodes the §5.8 gate (positive **and** objective co-signal → "do" lesson; negative → "avoid + correction" lesson; else skip). Fully unit-testable, no I/O. |
| `src/core/auxiliary/QueryBackedLessonDistillationService.ts` | **New.** Mirrors `QueryBackedInstructionRefineService`: wraps `AuxQueryRunner.query({ systemPrompt, model })`, routed by a configured `brain.distillModel` (defaults to the title-generation model). Input: gated turn excerpt + signal + outcome. Output: parsed candidate `BrainLesson[]`. |
| `src/core/prompt/lessonDistill.ts` | **New.** `buildLessonDistillSystemPrompt()` + `parseLessonDistillResponse()` (mirrors `instructionRefine.ts`). Instructs the model to emit small, itemized, provenance-tagged lessons and to surface contrasting worked-vs-failed pairs (ExpeL/ReasoningBank shape). |
| `src/app/brain/BrainLessonStore.ts` | **New.** Markdown-canonical store in a **visible, user-configurable vault folder** (`brain.folder`, default `Brain/`) — `lessons.md`, `facts.md`, `archive.md`. ACE discipline: `appendDelta` (append new bullet **or** deterministically bump a helpful/harmful counter — never LLM-rewrite); `read`; `latest`; `pruneAndArchive` (decay by last-accessed + counters). Each lesson is a markdown list item with frontmatter-ish inline fields. *(Visible-not-hidden is a product decision: the Brain's knowledge must be browsable/editable as ordinary vault notes — only the raw signal log stays in `.claudian/`.)* |
| `src/app/brain/brainTypes.ts` | **New.** `BrainLesson { id; polarity; trigger; content; correction?; helpful; harmful; sourceMessageId; sourceConversationId; lastAccessed; createdAt }`; `PendingLesson`; `BrainSettings`. |
| `src/app/brain/PendingLessonStore.ts` | **New.** `<brain.folder>/Pending.md` (visible) holding staged candidates until the user approves/edits/rejects. |
| `src/core/context/contextEnvelope.ts` | Add a `'brain'` `ContextSource` kind, trust-tagged **trusted** (user-owned), token-budgeted. The Brain supplies selected lessons here at turn build. |
| `src/features/settings/registry/...` | **New** feature-flagged **Brain** settings tab: enable toggle (off by default), first-run consent, **`brain.folder` (visible vault folder, default `Brain/`)**, scope/exclude paths, distill model, **pending-lessons review** (approve/edit/reject), lesson list (edit/delete — they're just markdown), "Open Brain folder", pause + wipe-all. |
| `src/main.ts` + commands | Construct `BrainService` when enabled; register commands **"Consolidate this session into the Brain"** and **"Prime this session from the Brain"** (the MVP manual path). |

## The outcome gate (the load-bearing logic)

```text
inputs for a completed turn:
  signals       = interactionSignalStore.signalsForMessage(assistantMessageId)
  objective     = { hadRuntimeError, toolErrors, toolWrites } from the turn's messages
  taskVerified? = (work-order run) handoff.verification present + non-failed

decision:
  POSITIVE lesson eligible  ⟺  (thumb-up OR copy) AND NOT hadRuntimeError AND NOT toolErrors
                                AND (taskVerified ?? true)
  NEGATIVE lesson eligible  ⟺  thumb-down OR rewind OR retry OR hadRuntimeError OR taskFailed
  else                      →  SKIP   (neutral / low-confidence only → never distill)
```

A thumb is **eligibility, not truth**: a positive lesson requires the thumb **and** an objective
co-signal (research §5.8.5). Implicit signals are weighted by `confidence`; a lone low-confidence
signal (interrupt/copy) never gates a lesson on its own.

## Lesson store format (ACE-itemized, append-only)

`<brain.folder>/lessons.md` (default `Brain/lessons.md`, **visible in the vault**) — human-readable, git-diffable, hand-editable:

```markdown
## Strategies & insights
- <!-- id:L7 helpful:4 harmful:0 src:msg_abc 2026-06-22 --> When editing files under `src/`,
  build DOM with Obsidian `createEl`/`MarkdownRenderer` — never `innerHTML` (lint blocks it).

## Common mistakes to avoid
- <!-- id:L9 helpful:2 harmful:0 src:msg_def 2026-06-22 --> Don't route compact turns through a
  normal send for Codex — use `thread/compact/start`. (correction applied after rewind on msg_def)
```

- **Append-delta only** — new bullets append; repeats bump the inline `helpful`/`harmful`
  counter via deterministic, non-LLM string edit. Never ask the model to rewrite the file
  (context collapse, research §3.4).
- **Provenance** (`src:`) links every lesson to its source turn so the user can audit/delete.
- **Decay** — `pruneAndArchive` moves low-`helpful`/high-`harmful`/stale (`lastAccessed`) bullets
  to `archive.md` (invalidate-don't-delete). Hard size cap with consolidate-on-overflow.

## Retrieval & injection

Two delivery channels (the second is specced fully in the **scheduler & publishing** spec):

- **Live chat (this spec):** MVP "Prime from Brain" command selects top-N lessons (lexical match
  on the user's prompt + `helpful` rank, token-budgeted ~2–3K) and adds them as a trusted
  `'brain'` `ContextSource`. Each injected lesson is **attributable** (carries its `id`/`src`).
  v1: gated auto-injection on send + a derived local index; per-step relevance gating
  (ReasoningBank discipline) is a v1 refinement.
- **Headless agents & first-prompt discovery (scheduler spec):** a background **scheduler**
  consolidates on a cadence and a **publisher** compiles approved lessons into a digest in a
  **configurable folder**, delivered to delegated/headless agents in their *first prompt* via
  `renderTaskPrompt` and (optionally) a managed `AGENTS.md`/`CLAUDE.md` pointer region. See
  `docs/superpowers/specs/2026-06-22-brain-scheduler-and-publishing-design.md`.

## Privacy, consent & security

- **Off by default**; first-run consent states exactly what is read (transcripts of completed
  turns in non-excluded scopes) and stored (distilled lessons; **no raw transcript**).
- **Distillation sends turn excerpts to the configured model** — the *same trust boundary as
  existing title generation*, which already sends content to a provider. Consent must say so;
  a fully-local distill model (Ollama via the configured runtime) is the privacy-max option.
- **Secret-scan + redact every proposed lesson** before staging (reuse the `Logger` redaction
  substrate / `scrubString`); transcripts can contain keys. Confine all writes to
  `brain.folder` (the visible Brain folder).
- The Brain's lessons are **visible vault notes by design** (the differentiation moat: your
  files, not a server's). Only the raw signal-capture log (`.claudian/feedback.jsonl`) stays
  hidden — it's machine telemetry, not human knowledge. Everything is editable + deletable;
  **pause** and **wipe-all** are
  one-switch. No silent capture, no invisible injection (every injected lesson is attributable).

## Edge cases & failure modes

| Case | Handling |
|------|----------|
| Turn has no signals at all | Gate → SKIP (ad-hoc chat without feedback isn't distilled; conservative per research). |
| Signal contradicts objective (thumb-up but `runtime_error`) | Objective wins for *positive* gating; may still distill an "avoid" lesson. |
| Distiller proposes a secret-bearing lesson | Secret-scan drops/redacts before staging; never auto-approved. |
| Lessons file grows unbounded | `pruneAndArchive` on a size cap; decay by counters + `lastAccessed`. |
| Provider/model for distill unavailable | Queue and retry; never block chat; `debug`-log. |
| User edits `lessons.md` by hand | Markdown is canonical; store re-reads it; no clobbering (append-delta only). |
| Brain disabled mid-session | Unsubscribe; stop injecting; existing files untouched. |

## Phasing

- **MVP (this spec, buildable):** `conversation:turn-completed`; `BrainService` + `OutcomeGate`;
  `QueryBackedLessonDistillationService` + `lessonDistill` prompt; `BrainLessonStore` (markdown,
  append-delta, decay); propose→approve via pending list; manual **Consolidate / Prime**
  commands; Brain settings tab; consent + scope + wipe-all. Lexical retrieval, no embeddings,
  no auto-injection.
- **v1:** gated auto-suggest on `conversation:turn-completed`; derived local index for relevance;
  gated auto-injection; cross-provider priming.
- **v2 (research §7):** skill promotion; cross-project meta-patterns; graph; outcome feedback
  loop (does a primed turn actually do better? weight accordingly).

## TDD test plan (mirrored under `tests/`)

1. `OutcomeGate.test.ts` — the truth table above: positive requires co-signal; negative triggers;
   low-confidence-only skips; contradiction resolves objective-wins.
2. `BrainLessonStore.test.ts` — append-delta adds a bullet; repeat bumps the counter (not a
   rewrite); `pruneAndArchive` moves stale/harmful to archive; hand-edited markdown round-trips;
   missing file → empty.
3. `QueryBackedLessonDistillationService.test.ts` — parses model output into `BrainLesson[]`;
   routes the configured model; aborts cleanly; tolerates malformed output (returns `[]`).
4. `BrainService.test.ts` — on `conversation:turn-completed`, joins signals + outcome, calls the
   gate, distills only when eligible, stages (never auto-writes), and respects the disabled flag.
5. `ConversationStore` turn-completed emission test (once per turn boundary, not on rename).
6. `tests/perf/brain.perf.test.ts` — distillation/retrieval cost tracks a bounded window, not
   transcript length (blocking perf gate, since the Brain reads transcripts).

Build order: event → gate (pure) → store → distiller → service wiring → settings/commands.
Run `npm run typecheck && npm run lint && npm run test && npm run build` per step.

## Quality gates

- LOC ratchet: several new small modules; budget the gate, split files if needed.
- **Perf gate is mandatory** — anything reading transcripts scales with length; the perf spec
  must assert bounded cost (research §3.6 principle 9; CLAUDE.md perf-suite rules).
- Lint: no `innerHTML`/`console.*`; render lessons via `MarkdownRenderer`; log via
  `plugin.logger.scope('brain')`; secrets never in brain files.
- **Evaluation before trust (research §3.6 #10):** ship behind the flag and compare primed vs
  cold turns (and vs a hand-written `AGENTS.md`) on quality *and* cost before enabling auto
  paths. The outcome feedback loop that measures this is v2.

## Open questions

1. Injection seam: add a `'brain'` `ContextSource` to `buildContextEnvelope` (recommended,
   provider-neutral) vs. feed the unused `mainAgent.ts` `appendices` slot? Envelope is cleaner;
   confirm during implementation.
2. Distill trigger granularity: per-turn vs per-session (batch at conversation close)? Lean
   per-session for MVP (less noise, cheaper) — but `conversation:turn-completed` is the hook.
3. Pending review surface: a settings-tab list (MVP, simplest) vs. an inline approval card
   (richer, reuses post-plan approval infra)? Start with the list.
4. Local-only distill model as the default to honor the privacy-max promise, or default to the
   title-gen model for quality? (Consent must disclose either way.)
