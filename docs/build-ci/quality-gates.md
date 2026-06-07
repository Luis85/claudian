---
title: "Agentic quality gates"
date: 2026-06-07
status: active
scope: build-ci
---

# Agentic quality gates

Machine-enforced guardrails so the repository's conventions stop being purely
social. Each gate fails fast in CI, before review has to catch the regression
by hand, and prints output short enough to act on without opening CI logs.

Background: `docs/tech-debt/2026-06-07-agentic-quality-gates.md`.

## Gates

| Gate | Command | CI job | What it catches |
|------|---------|--------|-----------------|
| Lint (errors) | `npm run lint` | `lint` | Error-level rules block CI. Warnings print but do **not** fail — see "Lint severity policy" below. |
| LOC guard | `npm run check:loc` | `lint` | New `src/**/*.ts` files above the cap; grandfathered hotspots that grow; stale baseline entries. |
| Typecheck | `npm run typecheck` | `typecheck` | Type regressions. |
| Tests | `npm run test` | `test` (Linux + Windows) | Behavior regressions on both path/spawn targets. |
| Coverage floors | `npm run test:coverage` | `coverage` | Coverage dropping below `coverageThreshold`. |
| Provider-boundary guards | `npm run test` | `test` | A registered provider with an incomplete `ProviderRegistration`; new hardcoded provider-id lists/switches outside `src/providers/index.ts`. See "Provider-boundary guards" below. |
| Production build | `npm run build` | `build` | CSS concat, esbuild bundle, SDK patching, renderer-unsafe-unref guard. |
| Artifact smoke | `npm run check:artifacts` | `build` | Missing/empty artifacts, package/manifest version desync, missing `minAppVersion`, bundle-size budget. |

Run the whole local set before pushing:

```bash
npm run lint && npm run check:loc && npm run typecheck && npm run test && npm run build && npm run check:artifacts
```

## Lint severity policy

Two tiers, on purpose:

- **`error`** — must-not-regress rules (no `console.*`, no raw HTML injection,
  `Notice` i18n, provider-boundary imports, import sorting, unused vars, …).
  These block CI. `npm run lint` exits non-zero on any of them.
- **`warn`** — an aspirational backlog burned down one item at a time. CI does
  **not** pass `--max-warnings`, so warnings print but never fail the build.
  This keeps the bar moving without blocking unrelated work on day one.

Current `warn`-tier rules: the staged `obsidianmd/*` set,
`@typescript-eslint/no-explicit-any`, and the function-health rules
(`max-lines-per-function` 200, `complexity` 25, `max-params` 6, `max-depth` 5
— ~61 warnings as of 2026-06-07). As the backlog clears, ratchet a threshold
down (or promote a clean rule to `error`) so the gain is locked in. Whole-file
size is already a hard gate via the LOC guard; the function-health rules add
function-level signal that file-level LOC can't see.

## LOC guard

`scripts/check-loc.mjs` counts nonblank lines for every `src/**/*.ts` file and
enforces a ratchet against `scripts/loc-baseline.json`:

- Files at or under `maxLoc` (500) are always fine.
- New files above the cap fail. Split them, or add an allowlist entry with a
  `reason`.
- Grandfathered hotspots may **shrink** but never grow past their recorded LOC.
  Existing debt can only get better.
- An allowlisted file that drops to `<= maxLoc` or is deleted makes its entry
  stale, which fails — keeping the baseline minimal and honest.

Regenerate the baseline (preserves existing `reason` text):

```bash
npm run check:loc -- --update
```

The per-file `reason` is the documented exception path the oversized-modules
tech debt asks for; the largest hotspots carry their planned split.

## Artifact smoke

`scripts/check-artifacts.mjs` is a post-build gate (it does not build). It
verifies `main.js`, `styles.css`, and `manifest.json` exist and are non-empty,
that `package.json` and `manifest.json` versions match, that `minAppVersion`
is present and recorded in `versions.json`, and that the bundles stay within a
byte budget with headroom for normal growth. Bump a budget deliberately, with a
reason in the PR, when a real dependency pushes the bundle up.

## Provider-boundary guards

Two runtime tests assert the `ProviderRegistry` seam (ADR 0001) and run in the
existing `test` job — no new tooling:

- `tests/unit/core/providers/providerRegistrationContract.test.ts` — iterates
  `getRegisteredProviderIds()`, so every provider (and any future one) is held
  to the full `ProviderRegistration` contract: `displayName`, capabilities whose
  `providerId` matches, non-empty `canonicalToolNames`,
  `chatUIConfig`/`settingsReconciler`/`historyService` methods, a resolvable
  `taskResultInterpreter`, a default config, and a `createChatRuntime` that
  yields a runtime tagged with its own id. Unknown ids throw rather than
  silently defaulting. The built-ins are checked as a subset (not an exact
  list), so registering a new provider needs no edit here.
- `tests/unit/core/providers/noHardcodedProviderList.test.ts` — fails when code
  names ≥3 distinct provider ids (comment-stripped) in any shape: an array
  literal, an array of `{ id: … }` objects, or a `switch`/comparison chain. The
  id set is derived from the registry, so the guard can't go stale, and an
  "allowlist honest" check drops exemptions once a file is cleaned up. Adding a
  provider must mean registering it and nothing else. Allowlisted today:
  `src/providers/index.ts` (the sanctioned aggregator) and
  `src/features/settings/firstRunBanner/FirstRunBanner.ts` (grandfathered; its
  per-provider `name`/`blurb`/`cli` list should move to the registry — see
  `docs/tech-debt/2026-06-07-firstrun-banner-provider-list.md`).

## Fallow (monitoring, not a gate)

`fallow` is a deterministic codebase-intelligence layer for TypeScript / JavaScript
([fallow-rs/fallow](https://github.com/fallow-rs/fallow)). It surfaces dead code,
duplication, complexity hotspots, and architecture-boundary violations as
**structured signal** for humans and agents. Findings are **non-blocking** today —
same posture as the perf suite — so the bar moves without day-one CI churn.

Config lives in `.fallowrc.json` at the repo root. Cache and intermediate output
go to `.fallow/` (already in `.gitignore`).

| Command | What it does |
|---------|--------------|
| `npm run quality` | dead-code + dupes + health in one pass |
| `npm run quality:audit` | changed-files review vs `main` (use before opening a PR) |
| `npm run quality:health` | maintainability score, hotspots, prioritized refactor targets |
| `npm run quality:dead-code` | unused exports / files / deps only |
| `npm run quality:dupes` | clone families across `src/**` (tests excluded by config) |

Baseline on 2026-06-07: 72 dead-code issues, 8 clone groups, 800 functions above
the complexity threshold, maintainability 90.2 (good). Use these as the trend
zero — treat regressions as PR-review signal, not as a merge block. If a finding
proves load-bearing, promote the specific check (not the whole tool) to an
`error`-tier gate the same way function-health rules will graduate from the lint
backlog.

## Next slices

Tracked here so the direction is explicit.

1. **Burn down the `warn` backlog, then ratchet.** Resolve function-health and
   staged `obsidianmd`/`no-explicit-any` warnings incrementally; each time a
   threshold reaches zero, tighten it (or promote the rule to `error`) so the
   gain can't regress. No big-bang refactor and no day-one CI block.
2. **Dependency-cycle budget** — **deferred**; existing cycles are too large to
   block on and need reducing first. See
   `docs/tech-debt/2026-06-07-import-cycle-budget.md`.
3. **Perf-gate wiring.** `tests/perf/*` are monitoring-only today
   (`docs/tech-debt/2026-06-07-perf-gates-blind-spots.md`); decide which
   scaling assertions graduate into a blocking job.

Done: provider-boundary regression tests and the no-new-provider-hardcoded-list
guard (remediation item 5 of the tech debt) — see "Provider-boundary guards".
