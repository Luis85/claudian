---
type: tech-debt
title: "Ratchet-down roadmap: grandfathered LOC, fallow, and coverage thresholds"
date: 2026-06-14
status: open
priority: "2 - medium"
severity: medium
scope: build-ci, module-depth
tags:
  - tech-debt
  - ci
  - quality-gates
  - ratchet
  - loc
  - coverage
  - maintainability
related:
  - "[[2026-06-07-agentic-quality-gates]]"
  - "[[2026-06-07-oversized-modules-and-test-files]]"
  - "[[2026-06-07-import-cycle-budget]]"
  - "[[2026-06-07-perf-gates-blind-spots]]"
---

# Ratchet-down roadmap: grandfathered LOC, fallow, and coverage thresholds

## Summary

The agentic quality-gate **machinery** is fully delivered and `done`
([[2026-06-07-agentic-quality-gates]]): CI enforces lint (all-error), LOC,
fallow quality, typecheck, tests (Linux + Windows), coverage floors, the
production build, artifact smoke, perf scaling, and provider-boundary
contracts. What remains is **the frozen debt the ratchets hold in place** — the
27 grandfathered LOC hotspots, the fallow counter baselines, and the coverage
floors. Those baselines freeze today's debt so it can only get better; nobody
has written down, in one place, *which* thresholds are still elevated, *why
each is hard to move further*, and *the order to attack them in*.

That is this note. It is the forward-looking companion to the **chronological**
burn-down log in `docs/build-ci/quality-gates.md` § "Next slices" (campaign runs
1–16): that section records what *was* done; this one prioritises what is
*left*, and is meant to be re-checked and trimmed as entries graduate.

Scope boundary: this note is about **tightening existing gates**, not adding new
ones. New-gate ideas (mutation testing, bundle-size-per-route, etc.) belong in a
separate proposal.

## Frozen baselines snapshot (2026-06-14)

| Gate | Where frozen | Current frozen value | Direction to tighten |
|------|--------------|----------------------|----------------------|
| LOC ratchet | `scripts/loc-baseline.json` | 27 hotspots > 500 LOC (8 of them > 1,000) | shrink ceilings; graduate entries off the allowlist |
| Clone families | `scripts/quality-baseline.json` `cloneGroups` | 32 | dedupe; counter → lower |
| Duplicated lines | `quality-baseline.json` `duplicatedLines` | 803 | dedupe; counter → lower |
| Complex functions | `quality-baseline.json` `complexFunctions` | 236 | decompose; counter → lower |
| Critical complexity | `quality-baseline.json` `criticalComplexity` | **0 (hold)** | must stay 0 |
| Structural counters | `quality-baseline.json` cycles/re-exports/boundary | **0 (hold)** | must stay 0 (ADR territory to bump) |
| Maintainability floor | `quality-baseline.json` `averageMaintainability` | 90.3 (floor) | raise as refactors land |
| Coverage floors | `jest.config.js` `coverageThreshold` | global 70/60/65/70 (+ per-dir) | raise toward measured actuals |
| Lint severity | `eslint.config.mjs` | all-error, **no `warn`-tier rules** | locked; `warn` tier free for staging a new rule |

Mechanics for every counter/LOC baseline are identical: shrink the real metric,
then lock the gain in the same PR (`npm run check:loc -- --update` /
`npm run check:quality -- --update`). See § "Ratchet mechanics" for the
`coverage/`-directory gotcha that can corrupt a fallow lock.

---

## 1. LOC ratchet — the 27 grandfathered hotspots

Shrink-only against `scripts/loc-baseline.json`; the per-entry `reason` carries
the planned split. The deep work — splitting cohesive coordinators behind
smaller interfaces — is the substance of [[2026-06-07-oversized-modules-and-test-files]]
(now `done`, but it explicitly invites fresh decomposition follow-ups). Three
tiers, by payoff:

### 1a. Near-term graduations (free / cheap)

The run-7→16 campaign shrank several entries well under their recorded ceiling,
and PR #100 (the OpenCode sqlite extraction) shrank one to the edge:

- **`OpencodeHistoryStore.ts` is now 501 LOC** (ceiling 545). It is **one line
  from graduating off the allowlist**. The LOC guard *fails* on a stale entry
  (an allowlisted file at `<= 500`), so the graduation move is deliberate:
  shrink it ≥2 nonblank lines **and delete its baseline entry in the same PR**
  → 27 hotspots become 26. Cheapest possible ratchet win; do it next time the
  file is touched.
- A plain `npm run check:loc -- --update` re-locks every entry that drifted
  below its ceiling (e.g. after extractions), tightening the gate for free.
  Ship it **standalone** — a full regen pulls cumulative shrinkage from
  unrelated files into a feature PR (per run 12a).

### 1b. The eight > 1,000-LOC coordinators (the real depth debt)

These are the accepted grandfathered exception: cohesive owners held shrink-only.
Each carries a planned seam; none is "open work" until someone picks one up, but
this is where agent-navigability cost concentrates.

| LOC | Module | Planned seam (from `reason` / oversized-modules doc) |
|---:|---|---|
| 1,599 | `providers/claude/runtime/ClaudeChatRuntime.ts` | extract persistent-query lifecycle (`ensureReady`, `needsRestart`, response-consumer startup) behind a smaller interface |
| 1,514 | `features/chat/controllers/StreamController.ts` | largest remaining; split the per-chunk tool/stream reducers from the lifecycle/scroll/abort coordination |
| 1,404 | `features/chat/controllers/InputController.ts` | extract the resume dropdown and the plan/approval state machine (send-path already decomposed into `composerSendPhases`) |
| 1,143 | `providers/opencode/runtime/OpencodeChatRuntime.ts` | ACP wiring vs. turn/session coordination |
| 1,141 | `features/chat/ClaudianView.ts` | lifecycle/assembly vs. the scope/shortcut + work-order-tab wiring |
| 1,079 | `providers/codex/runtime/CodexChatRuntime.ts` | app-server turn lifecycle vs. collaboration-mode/plan handling |
| 1,061 | `features/chat/rendering/MessageRenderer.ts` | message orchestration vs. the per-block renderers it still inlines |
| 1,010 | `features/chat/tabs/TabManager.ts` | tab CRUD vs. fork-target + provider-aware command-catalog coordination |

Guidance (unchanged from the oversized-modules doc): split only what passes the
**deletion test** — where deleting the module would smear ordering constraints
and state-machine complexity across callers. Extract **out to siblings** so the
hotspot shrinks rather than editing in place; keep behavior-preserving tests at
the new interface, not at collaborator-call wiring.

### 1c. The 500–1,000 tier (18 entries)

`ConversationController` 999, `AgentBoardRenderer` 948, `SubagentManager` 936,
`AgentBoardView` 890, `CodexNotificationRouter` 879, `ToolCallRenderer` 854,
`WorkOrderDetailModal` 787, `InlineEditModal` 785, `main` 767, `i18n/types` 763,
`CodexHistoryStore` 746, `RunSession` 625, `core/providers/types` 594,
`codexAppServerTypes` 593, `SubagentRenderer` 566, `InlineAskUserQuestion` 564,
`OpencodeHistoryStore` 545 (now 501), `cursorToolNormalization` 542,
`ClaudianSettings` 526. Lower individual payoff; tackle opportunistically when a
feature already touches one. Two are **type/declaration** files
(`core/providers/types`, `codexAppServerTypes`) — splitting by domain (per
ADR-0001 seam) is low-risk. `i18n/types` grows ~2 lines per new setting and is a
poor split target; accept it or generate it.

---

## 2. Fallow quality ratchet — the metric tail

The easy wins are spent (campaign runs 8–16 took `duplicatedLines` 1,790 → 803,
`cloneGroups` 68 → 32, `criticalComplexity` 59 → 0). What remains is the
**diminishing-returns tail**; treat further movement as opportunistic, not a
sprint.

- **`cloneGroups` 32 / `duplicatedLines` 803.** The remaining clones are the
  *entangled cross-zone runtime* families — provider↔provider tool normalization
  and the `ChatRuntime` shapes — whose only shared home is `core/`. Deduping
  them means a `core/` module more invasive than the win (run 11/15 deferred
  them deliberately). Only pursue when a runtime is being reworked anyway.
  Same-zone/same-file copy-paste should still be extracted on sight (the gate
  catches new pairs at `minOccurrences: 2`).
- **`complexFunctions` 236.** Fallow counts cyclomatic ≥ 20 **OR** cognitive
  ≥ 15 **OR CRAP ≥ 30**. CRAP is coverage-weighted, so the remaining tail is
  *low-cognitive, low-coverage* functions where the cheapest fix is often a
  **test** (raising coverage drops CRAP below 30) rather than a decomposition.
  Drive it hotspot-by-hotspot with `npm run quality:health --targets`; expect
  ever-smaller gate deltas. A decomposed helper can re-trip CRAP if it is itself
  uncovered — keep new helpers cyclomatic ≲ 6 (the run-10 lesson).
- **Hold-the-line counters.** `criticalComplexity` and the three structural
  counters (`circularDependencies`, `reExportCycles`, `boundaryViolations`) are
  at 0 and must stay there. The ratchet mechanics *could* bump them, but a new
  critical-severity function or boundary violation is an **architecture
  decision** (ADR territory), not a metric trade-off — split/relocate before
  merge. The boundary zones encode ADR-0001 (`.fallowrc.json`).
- **`averageMaintainability` 90.3 (floor).** Rises only as decompositions land;
  lock the higher floor when a refactor moves it.

---

## 3. Coverage floors — raise toward actuals, then lift the laggard

Floors in `jest.config.js` sit a few points **below** the 2026-05-31 measured
actuals (regression floors, not aspirations). Two distinct moves:

### 3a. Re-lock the floors (cheap, high value)

Coverage has drifted up since 2026-05-31 without the floors following, so the
gate gives uncredited slack. Re-measure (`npm run test:coverage`), then raise
each floor to a few points under current actual. Pure edit to `jest.config.js`;
locks gains so a future slip actually trips. Pairs naturally with any
test-adding PR.

### 3b. Lift the genuinely under-covered area

`src/providers/opencode/runtime/` is the laggard — actual **64 / 51 / 59 / 64**
(stmt/branch/func/lines), floor 59/45/53/59. Branch coverage at ~51 % means
half the runtime's decision points are untested; this is the same provider whose
history hydration just needed hardening (#776). `src/providers/cursor/runtime/`
is next (76/62/76/77). Targeted tests here are a real robustness win, not just a
number — and every point earned lets the floor rise. The security/utils/logging/
mcp areas are already 92–99 % and need only floor maintenance.

---

## 4. Lint — locked, nothing to ratchet

The lint gate is **all-error**; `eslint --print-config` shows no `warn`-tier
rule, and CI does not pass `--max-warnings` (so a `warn` rule would never fail —
hence the all-error invariant matters). No debt here. The `warn` tier remains
available as the **staging lane** for a *future* aspirational rule: ship it at
`warn`, burn its offenders to zero, promote to `error` — the proven path (every
`obsidianmd/*`, `no-explicit-any`, `max-params`, `max-depth`, `complexity` 25,
`max-lines-per-function` 200, and the jest rules went this way). Documented in
`docs/build-ci/quality-gates.md` § "Lint severity policy".

---

## 5. Prioritised roadmap

Ranked by payoff ÷ effort. Each is independently shippable.

1. **Re-lock coverage floors + the fallow `--update` drifts** (XS effort, locks
   already-earned gains). The cheapest tightening on the board.
2. **Graduate `OpencodeHistoryStore` off the LOC allowlist** (XS; shrink ≥2
   lines + delete the entry → 27 → 26 hotspots).
3. **Lift `opencode/runtime` (and then `cursor/runtime`) branch coverage** (M;
   genuine robustness win on the least-tested runtimes; unlocks floor raises).
4. **Pick one > 1,000-LOC coordinator and split it behind a smaller interface**
   (L each; the real depth debt — `StreamController` or `InputController` first,
   both chat-controller hotspots agents touch constantly). Behavior-preserving,
   extract-to-sibling.
5. **Opportunistic clone/complexity burn-down** (S, diminishing returns) — only
   when a runtime/file is already open; do not sprint the entangled cross-zone
   tail.

Explicit non-goals: bumping any baseline upward to "make room" (Codex review on
PR #100 — hold the ratchet; offset additions with real reductions), and
splitting cohesive owners purely to hit a number.

## Ratchet mechanics

- LOC: `npm run check:loc -- --update` (preserves `reason` text). Graduating a
  file means shrinking it `<= 500` **and** deleting its entry in the same PR.
- Fallow: `npm run check:quality -- --update`, committed in the PR that moved the
  metric. **Gotcha:** lock the baseline with the `coverage/` directory **absent**
  — a stray `coverage/` flips fallow from `static_estimated` to istanbul
  coverage and spikes `criticalComplexity` 0 → ~24 (run 9). CI's `quality` job
  has no coverage artifact; match it. Run `npm run test:coverage` last.
- Coverage: edit `jest.config.js` `coverageThreshold` directly; floors a few
  points under measured actuals.

## Acceptance criteria (per threshold; check off as they graduate)

- [ ] LOC allowlist drops below 27 entries (start with `OpencodeHistoryStore`).
- [ ] At least one > 1,000-LOC coordinator split behind a smaller interface.
- [ ] Coverage floors re-locked to within a few points of current actuals.
- [ ] `opencode/runtime` branch coverage floor raised above 50 %.
- [ ] `criticalComplexity` and the three structural counters held at 0.
- [ ] No baseline (LOC or fallow) raised without an offsetting real reduction.
