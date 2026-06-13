---
type: tech-debt
title: "CI does not enforce agentic quality gates"
date: 2026-06-07
updated: 2026-06-13
status: done
priority: "1 - high"
severity: high
scope: build-ci
tags:
  - tech-debt
  - ci
  - lint
  - agentic-workflow
  - quality-gates
related:
  - "[[2026-06-05-plugin-improvement-roadmap]]"
  - "[[2026-05-28-plugin-improvement-research-proposal]]"
  - "[[2026-06-07-oversized-modules-and-test-files]]"
---

# CI does not enforce agentic quality gates

## Summary

The repository has strong conventions, but they are still partly social: an agent can create very large files, skip the production build, add lint warnings, or leave generated release artifacts stale while the PR CI remains green. This is the tech debt the user already called out: the agentic workflow needs machine-enforced rules in lint/build/CI, including a maximum-LOC guard.

## Evidence

- `.github/workflows/ci.yml` runs `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:coverage`; it does **not** run `npm run build`.
- `package.json` has a production build script (`npm run build`) that exercises CSS concatenation, esbuild bundling, SDK patching, and release artifact generation, but that script is only used by release/manual flows.
- `eslint.config.mjs` keeps some staged guardrails as warnings (`obsidianRuleSeverity = 'warn'`, `@typescript-eslint/no-explicit-any: 'warn'`). `npm run lint` does not pass `--max-warnings=0`, so future warning regressions can pass CI.
- Local review on 2026-06-07 found `npm run lint` exits 0 and `npm run typecheck` exits 0, but there is no CI rule for file-size drift, build artifact drift, perf drift, or architecture drift.
- Current size baseline from `git ls-files`: 522 tracked `src/**/*.ts` files, ~84,048 nonblank LOC; 35 source files exceed 500 nonblank LOC and 12 exceed 1,000.

## Why it matters

Agentic contributors optimize for finishing the requested change. Without objective gates, they can accidentally deepen long-term maintenance cost: bigger files, unbuilt CSS/assets, warning-only lint debt, or unverified runtime bundle changes. A rule should fail early in CI, before review has to catch it manually.

## Suggested remediation

1. Add a `check:loc` script with a checked-in baseline and thresholds.
   - Fail on new `src/**/*.ts` files above a hard cap, for example 500 or 750 LOC.
   - Grandfather current known hotspots temporarily with explicit justifications.
   - Add a stricter cap for newly-created files than existing legacy files.
2. Change CI lint to fail warnings once the current baseline is clean.
   - Example: `eslint ... --max-warnings=0` or a wrapper script that reports warning counts.
3. Add `npm run build` to pull-request CI.
4. Add an artifact smoke script for `main.js`, `styles.css`, `manifest.json`, version sync, `minAppVersion`, and bundle size budget.
5. Consider architecture gates after the first slice: dependency-cycle budget, provider-boundary regression tests, and no-new-provider-hardcoded-list checks.

## Acceptance criteria

- [x] CI fails if `npm run build` fails. — new `build` job in `.github/workflows/ci.yml`.
- [x] CI fails on lint warnings, not only lint errors. — **Achieved via the staged-promotion path (completed 2026-06-13):** rather than flipping `--max-warnings=0` on day one, each aspirational rule started at `warn`, was burned down to zero offenders, then promoted to `error`. All staged rules are now promoted (`obsidianmd/*`, `no-explicit-any`, `max-params`, `max-depth` on 2026-06-10; `complexity` 25 + `max-lines-per-function` 200 on 2026-06-13 run 7; and the remaining test rules `jest/expect-expect` + `jest/no-disabled-tests` + `jest/no-commented-out-tests` on 2026-06-13 run 13), so **no `warn`-tier rules remain** (`eslint --print-config` confirms) and the lint gate is all-error. See `docs/build-ci/quality-gates.md` § "Lint severity policy".
- [x] CI fails when a new source file exceeds the configured max LOC unless it is explicitly allowlisted. — `npm run check:loc` (`scripts/check-loc.mjs` + `scripts/loc-baseline.json`), wired into the `lint` job.
- [x] CI fails if production artifacts are stale or missing. — `npm run check:artifacts` (`scripts/check-artifacts.mjs`) runs after build in the `build` job; covers presence, version sync, `minAppVersion`, and a bundle-size budget.
- [x] The check output is short enough for agents to act on without reading CI logs manually. — both checks print a one-line OK summary and a compact, file-listed failure report.

## Suggested first PR

Start with a non-invasive guardrail PR: `check:loc` + `npm run build` in CI + `--max-warnings=0`. Keep the LOC gate baseline-aware so this PR documents existing hotspots without forcing every split at once.

## Resolution (first slice — 2026-06-07)

Delivered the suggested first PR. See `docs/build-ci/quality-gates.md` for the
catalog of gates, how to run them locally, and how to extend them. Remaining
work tracked under "Next slices" in that doc. Note: `--max-warnings=0` was
**not** adopted — by decision (see the revised acceptance criterion above),
warnings are a non-blocking backlog burned down incrementally; error-tier rules
block CI.

## Progress (2026-06-09)

Reconciled against current reality (`.github/workflows/ci.yml`, `package.json`
scripts, `scripts/check-loc.mjs`, `scripts/check-artifacts.mjs`):

- **Shipped:** CI `lint` job runs `npm run lint` + `npm run check:loc`;
  `typecheck`, `test` (Linux + Windows), and `coverage` jobs; `build` job runs
  `npm run build` + `npm run check:artifacts`. All jobs on Node 22, now matched
  by the release workflow and `package.json` `engines` (see
  `[[2026-06-07-release-artifact-reproducibility]]`, closed 2026-06-09).
- **Shipped (remediation item 5, partial):** provider-boundary regression tests
  (`tests/unit/core/providers/providerRegistrationContract.test.ts`) and the
  no-new-provider-hardcoded-list guard
  (`tests/unit/core/providers/noHardcodedProviderList.test.ts`) run in the
  existing `test` job — see `docs/build-ci/quality-gates.md`
  § "Provider-boundary guards".
- **Open:** the lint `warn`-tier backlog (staged `obsidianmd` rules,
  `no-explicit-any`, function-health rules) is still being burned down and
  ratcheted.

## Progress (2026-06-10)

- **Shipped (architecture-gate slice):** the dependency-cycle budget closed at
  zero — fallow's type-aware graph shows no genuine cycles, so
  `circularDependencies`, `reExportCycles`, and `boundaryViolations` joined the
  `check:quality` ratchet pinned at 0, with ADR 0001 layer rules declared as
  fallow boundary zones in `.fallowrc.json`
  (`[[2026-06-07-import-cycle-budget]]`, now `done`).

## Resolution (2026-06-13)

`done`. Every acceptance criterion is met and every suggested-remediation item
has shipped:

- **Gates live in CI** (`.github/workflows/ci.yml`): `lint` (+ `check:loc`),
  `typecheck`, `test` (Linux + Windows), `coverage`, `build` (+
  `check:artifacts`), `perf`, and `quality` (the fallow ratchet,
  `npm run check:quality`).
- **LOC guard** with a baseline-aware ratchet (`scripts/check-loc.mjs`);
  grandfathered hotspots are shrink-only and were re-locked to current size in
  run 12a.
- **Architecture gates** (remediation item 5): provider-boundary contract test,
  no-new-provider-hardcoded-list guard, and the fallow structural counters
  (`circularDependencies`, `reExportCycles`, `boundaryViolations`) pinned at 0.
- **Lint-severity policy complete:** the `warn`-tier backlog was burned to zero
  and every staged rule promoted to `error` (the final test rules —
  `jest/expect-expect`, `jest/no-disabled-tests`, `jest/no-commented-out-tests` —
  in run 13). `eslint --print-config` reports no rule at `warn`, so the "CI fails
  on lint warnings" intent is satisfied by there being no warn-tier rules at all.

The fallow quality campaign (runs 1–13) then drove the ratcheted metrics down
from the monitoring-only baseline: `criticalComplexity` 59→0, `cloneGroups`
68→33, `duplicatedLines` 1790→819, `complexFunctions` 271→237, all structural
counters at 0, maintainability 90.2→90.3. Ongoing metric burn-down is tracked
under "Next slices" in `docs/build-ci/quality-gates.md`; the gate *machinery*
this debt called for is fully delivered.
