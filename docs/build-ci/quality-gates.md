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

## Next slices

Not yet enforced; tracked here so the direction is explicit.

1. **Burn down the `warn` backlog, then ratchet.** Resolve function-health and
   staged `obsidianmd`/`no-explicit-any` warnings incrementally; each time a
   threshold reaches zero, tighten it (or promote the rule to `error`) so the
   gain can't regress. No big-bang refactor and no day-one CI block.
2. **Architecture gates** (remediation item 5 of the tech debt):
   - dependency-cycle budget — **deferred**; existing cycles are too large to
     block on and need reducing first. See
     `docs/tech-debt/2026-06-07-import-cycle-budget.md`.
   - provider-boundary regression tests beyond the `no-restricted-imports`
     lint rule (assert the registry seam at runtime) — planned for a follow-up
     PR.
   - a no-new-provider-hardcoded-list check so adding a provider does not
     require editing scattered switch/array literals — planned for a follow-up
     PR.
3. **Perf-gate wiring.** `tests/perf/*` are monitoring-only today
   (`docs/tech-debt/2026-06-07-perf-gates-blind-spots.md`); decide which
   scaling assertions graduate into a blocking job.
