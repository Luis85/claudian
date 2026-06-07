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
| Lint (no warnings) | `npm run lint` | `lint` | Errors **and** warnings — `--max-warnings=0`. New warning-level debt fails. |
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

1. **Tighten staged lint to error.** `obsidianmd/*` rules and
   `@typescript-eslint/no-explicit-any` are still `warn` in `eslint.config.mjs`.
   Once each is baseline-clean in `src/`, promote it to `error` (the
   `--max-warnings=0` gate already blocks *new* warnings).
2. **Architecture gates** (remediation item 5 of the tech debt):
   - dependency-cycle budget (e.g. `madge`/`dpdm` over `src/`),
   - provider-boundary regression tests beyond the `no-restricted-imports`
     lint rule (assert the registry seam at runtime),
   - a no-new-provider-hardcoded-list check so adding a provider does not
     require editing scattered switch/array literals.
3. **Perf-gate wiring.** `tests/perf/*` are monitoring-only today
   (`docs/tech-debt/2026-06-07-perf-gates-blind-spots.md`); decide which
   scaling assertions graduate into a blocking job.
