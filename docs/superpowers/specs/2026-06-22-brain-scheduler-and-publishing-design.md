---
title: Brain scheduler & lesson publishing (consolidate on a cadence, publish for agents)
date: 2026-06-22
status: draft
scope: app/brain, features/tasks (prompt), features/settings, main.ts
parent: "[[docs/research/2026-06-22-brain-feature-research]]"
related:
  - "[[docs/superpowers/specs/2026-06-22-brain-service-design]]"
  - "[[docs/superpowers/specs/2026-06-22-implicit-interaction-signal-capture-design]]"
---

# Brain scheduler & lesson publishing

## Problem

The Brain service spec distills lessons reactively (manual command or per-turn) and injects them
into *live chat* via the `ContextEnvelope`. Two gaps remain:

1. **No background cadence.** The research's production consensus is **asynchronous background
   consolidation** — "optimize for fast reads, slow writes" (Letta sleep-time agents, Hermes'
   4 AM pass, Perplexity's overnight synthesis). Consolidation should run off the hot path on a
   schedule, not only when the user remembers to ask.
2. **Headless / delegated agents can't reach the in-context lessons.** Agent Board work orders
   and subagents assemble their **own first prompt** via `renderTaskPrompt`
   (`features/tasks/prompt/TaskPromptRenderer.ts:56`) — they are not on the chat
   `ContextEnvelope` path. They need the lessons as a **durable, discoverable file** they can be
   pointed at in their first prompt.

This spec adds a **scheduler** that consolidates on a cadence and a **publisher** that compiles
the trusted lessons into an agent-discoverable digest in a **configurable folder** — so every
agent, including headless runs, finds the lessons-learned at the start of its work.

## Design principle: separate the *working store* from the *published digest*

- **Working store** (`BrainLessonStore`, from the service spec): ACE-itemized lessons with
  counters + provenance under `.claudian/brain/`. Machine-oriented; the Brain's internal memory.
- **Published digest** (new): a clean, ranked, deduped, token-budgeted **Markdown file in a
  configurable folder**, regenerated from the *approved* working-store lessons. Human- and
  agent-readable; the thing agents consume.

This mirrors the research's fast-reads/slow-writes split: the scheduler does the slow write
(distill + compile); agents do a fast read of a ready file. Publishing introduces **no new trust
decision** — it only compiles already-approved lessons — so it can run automatically while
approval stays human-gated.

## The scheduler

`BrainScheduler` (app-shell, `src/app/brain/BrainScheduler.ts`), driven by `registerInterval`
(idiomatic; precedent: the Agent Board's 60s orphan re-check). Off unless `brain.enabled` **and**
`brain.scheduler.enabled`.

**Triggers (configurable `brain.scheduler.cadence`):**

| Mode | Behavior |
|------|----------|
| `off` | Manual only (the service spec's Consolidate command). |
| `on-session-end` | Subscribe to `conversation:turn-completed` / `task:run-finished`; consolidate the just-finished session (debounced). |
| `every-n-sessions` | Count completed sessions; consolidate every N. |
| `hourly` / `daily@HH:MM` | Time-based. Obsidian has no cron and the app may be closed, so persist `lastConsolidatedAt`; a coarse interval tick (e.g. every 5 min) runs the pass when `now − lastConsolidatedAt ≥ cadence` (**catch-up** on next launch if a window was missed). The `daily@HH:MM` mode is the Hermes "4 AM" pattern. |
| `idle` | After M minutes of no chat/Agent-Board activity (Letta sleep-time analog). |

**Pipeline per run (single-flight, cancellable, best-effort):**

```text
1. select NEW eligible turns since lastConsolidatedAt   (bounded — never re-scan all history)
2. for each → OutcomeGate → LessonDistiller            (service spec; cost-budgeted)
3. stage candidates as PendingLessons                   (human approval unchanged by default)
4. PUBLISH: compile approved lessons → digest file      (always; no new trust decision)
5. persist lastConsolidatedAt / lastPublishedAt
```

Guarantees: never overlaps a prior run (single-flight lock); never blocks the UI (runs on the
microtask/idle path); a model/IO failure is caught + `debug`-logged and the next tick retries;
only **new** turns are distilled each run so cost tracks recent activity, not transcript history.

**Unattended operation vs. trust.** Scheduled *distillation* runs automatically and produces
*pending* lessons; *approval* stays human-gated by default. For hands-off setups, an opt-in
`brain.autoApproveVerified` promotes only lessons whose positive signal is backed by a strong
objective co-signal (test/lint/build passed, or task `verification`) — never a bare thumb.
Default **off**.

## The publisher

`LessonPublisher` (`src/app/brain/LessonPublisher.ts`) compiles the approved working-store
lessons into the digest and writes it atomically (mirror `TaskNoteStore.replaceGeneratedRegion`).

**Configurable output (settings):**

| Setting | Default | Purpose |
|---------|---------|---------|
| `brain.publishFolder` | `brain.folder` (visible, default `Brain/`) | Where the digest lives — defaults to the same **visible** Brain folder as the lesson store (product decision: the Brain stays visible to the user). Configurable, but not hidden under `.claudian/`. |
| `brain.publishFileName` | `Lessons Learned.md` | The digest file name. |
| `brain.agentsIntegration` | `pointer` | How provider-native agent files reference the digest: `off` / `pointer` / `inline` (below). |
| `brain.injectIntoWorkOrders` | `true` | Whether `renderTaskPrompt` includes a lessons section. |

**Digest format** — ranked (by `helpful` count + recency), deduped, token-budgeted, grouped, each
lesson one line with optional provenance; a header states it is Brain-generated and editable:

```markdown
<!-- Generated by the Brain — edit lessons in their source notes; this file is recompiled. -->
# Lessons Learned

## Do
- When editing `src/`, build DOM with `createEl`/`MarkdownRenderer` — never `innerHTML`.

## Avoid
- Don't route Codex compact turns through a normal send — use `thread/compact/start`.
```

**Provider-native discovery (`brain.agentsIntegration`).** The research showed `AGENTS.md`
(read by Codex/Cursor/Cline) and `CLAUDE.md` (read by Claude) are the convergent "first prompt"
files. Rather than **clobber** user-maintained files (the Cursor Memories→Rules trust lesson,
research §5.8.5), the publisher only manages a bounded region:

- `off` — publish the standalone digest only.
- `pointer` (default) — write/refresh a managed `<!-- brain:lessons start/end -->` region in
  the repo's `AGENTS.md`/`CLAUDE.md` containing **one line** pointing to the digest
  (`See [[Brain/Lessons Learned]] before starting.`), so the provider surfaces it natively in
  the first prompt with zero injection plumbing. User content outside the region is untouched.
- `inline` — same managed region, but the compiled digest is embedded directly (for users who
  don't want a second file).

## Agent first-prompt delivery (the "easy to find" requirement)

Three complementary delivery paths, so the lessons reach every agent shape:

1. **Live chat** — the service spec's trusted `'brain'` `ContextEnvelope` source (in-context).
2. **Headless Agent Board runs** — `renderTaskPrompt` gains an optional **"## Project Lessons"**
   section (gated by `brain.injectIntoWorkOrders`), sourced from the published digest and
   token-capped, so a delegated agent reads lessons in its **first prompt**. Subject to the same
   `escapeClaudianMarkers` treatment as other interpolated content.
3. **Provider-native** — the `AGENTS.md`/`CLAUDE.md` pointer/inline region, for any agent (incl.
   CLI invocations outside Specorator) that auto-reads those files.

A user can rely on (1)+(2) alone, or add (3) for portability to other tools.

## Components

| File | Change |
|------|--------|
| `src/app/brain/BrainScheduler.ts` | **New.** Cadence + catch-up via `registerInterval`; single-flight; subscribes for `on-session-end`/`every-n-sessions`/`idle`; drives the consolidation pipeline + publish. |
| `src/app/brain/LessonPublisher.ts` | **New.** Compile approved lessons → digest; atomic write; managed-region writer for `AGENTS.md`/`CLAUDE.md`; honors `publishFolder`/`publishFileName`/`agentsIntegration`. |
| `src/app/brain/schedulerState.ts` | **New.** Persist `lastConsolidatedAt`/`lastPublishedAt`/session counters (in `brain` settings or a small state file). |
| `src/features/tasks/prompt/TaskPromptRenderer.ts` | Add an optional `projectLessons?: string` section (capped, escaped) to `renderTaskPrompt`; the Agent Board wiring passes the published digest excerpt when `brain.injectIntoWorkOrders`. |
| `src/features/settings/registry/...` (Brain tab) | Add scheduler + publishing fields: `scheduler.enabled`, `scheduler.cadence`, `scheduler.dailyTime`, `autoApproveVerified`, `publishFolder`, `publishFileName`, `agentsIntegration`, `injectIntoWorkOrders`, plus a "Publish now" / "Consolidate now" button. |
| `src/main.ts` | Construct `BrainScheduler` when enabled; dispose on unload. |

Dependency direction stays clean: the scheduler/publisher live at the app shell (compose
features + core); `renderTaskPrompt` receives the lessons string as a **parameter** (tasks does
not import brain) — the Agent Board wiring at the app/view layer supplies it, mirroring how
`TaskPromptLaneCriteria` is already passed in.

## Privacy, trust & safety

- **Off by default** (both `brain.enabled` and `brain.scheduler.enabled`). Consent covers the
  scheduler reading completed sessions on a cadence.
- **Only approved lessons are ever published.** Scheduled distillation still stages for review;
  `autoApproveVerified` is opt-in and restricted to objectively-verified lessons.
- **Secret-scan before publish** (reuse `scrubString`); confine writes to `publishFolder` +
  the managed `AGENTS.md`/`CLAUDE.md` region (path-confined, never outside it).
- **Never clobber user files** — `AGENTS.md`/`CLAUDE.md` edits are limited to the
  `<!-- brain:lessons -->` managed region; everything else is preserved.
- The digest is a visible, editable vault file; `pause` stops the scheduler, `wipe-all` removes
  the digest and managed regions too.

## Edge cases & failure modes

| Case | Handling |
|------|----------|
| App closed across a scheduled window | Catch-up on next launch via `lastConsolidatedAt`. |
| Two ticks overlap (long distill) | Single-flight lock; second tick no-ops. |
| `publishFolder` doesn't exist | Create it (segment-walk + EEXIST tolerance, like `RunSidecarStore`). |
| `AGENTS.md` absent | `pointer`/`inline` create it with only the managed region; or skip if user set `off`. |
| Digest would exceed token budget | Rank by `helpful`+recency, truncate to budget; full set stays in the working store. |
| Distill model unavailable on a tick | Skip distill, still republish existing approved lessons; retry next tick. |
| User hand-edits the digest | Header warns it's recompiled; edits to *lessons* should be made in the working store. (Open question: support digest→store back-edit?) |
| Work-order prompt injection makes prompts huge | `injectIntoWorkOrders` cap + toggle; lessons section is token-bounded. |

## TDD test plan

1. `BrainScheduler.test.ts` — cadence decision (runs when overdue, skips when fresh); catch-up
   after a missed window; single-flight (no overlap); `on-session-end`/`every-n-sessions`
   counting; disabled flag short-circuits.
2. `LessonPublisher.test.ts` — compiles ranked/deduped/budgeted digest; atomic rewrite;
   `pointer`/`inline`/`off` managed-region behavior; never touches content outside the region;
   honors `publishFolder`/`publishFileName`; secret-scrub.
3. `TaskPromptRenderer.test.ts` — extend: lessons section appears only when supplied + under
   `injectIntoWorkOrders`; escaped; token-capped.
4. `schedulerState.test.ts` — persists/restores last-run timestamps + counters.
5. `tests/perf/brainScheduler.perf.test.ts` — a consolidation pass cost tracks **new** turns
   since last run (bounded window), not total history (blocking perf gate).

## Quality gates

- LOC ratchet: several small modules; budget the gate.
- **Perf gate mandatory** — the pass reads transcripts; assert bounded-by-new-turns cost.
- Lint: no `innerHTML`/`console.*`; render via `MarkdownRenderer`; log via
  `plugin.logger.scope('brain')`; managed-region writes via the existing atomic
  `replaceGeneratedRegion` helper.

## Phasing

- **MVP:** `on-session-end` + manual "Consolidate/Publish now"; standalone digest in
  `publishFolder`; `injectIntoWorkOrders` for Agent Board first prompts. `pointer` integration.
  No time-based cron, no idle, no auto-approve.
- **v1:** `hourly`/`daily@HH:MM`/`idle` cadences; catch-up; `autoApproveVerified` (opt-in);
  `inline` integration.
- **v2:** publish provider-scoped digests; per-project digests; derived index so the digest is
  relevance-selected per work order rather than global.

## Open questions

1. ~~Default `publishFolder` visible vs hidden?~~ **Resolved: visible.** The Brain stays visible
   to the user — the lesson store *and* the digest live in the configurable `Brain/` folder;
   only the raw signal log stays under `.claudian/`.
2. Support editing a lesson *in the digest* and syncing back to the working store, or keep the
   digest strictly read-only/recompiled? Lean recompiled-only for MVP (single source of truth).
3. Per-work-order relevance selection (only inject lessons matching the task) vs a global digest?
   Global for MVP; relevance is v2.
4. Should `daily@HH:MM` honor a quiet-hours / on-battery guard to avoid surprise model spend?
   Likely yes in v1.
