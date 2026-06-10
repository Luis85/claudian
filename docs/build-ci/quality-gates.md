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
| Quality ratchet | `npm run check:quality` | `quality` | A fallow metric (dead code, duplication, complexity, maintainability) regressing past `scripts/quality-baseline.json`. See "Fallow quality ratchet" below. |
| Typecheck | `npm run typecheck` | `typecheck` | Type regressions. |
| Tests | `npm run test` | `test` (Linux + Windows) | Behavior regressions on both path/spawn targets. |
| Coverage floors | `npm run test:coverage` | `coverage` | Coverage dropping below `coverageThreshold`. |
| Provider-boundary guards | `npm run test` | `test` | A registered provider with an incomplete `ProviderRegistration`; new hardcoded provider-id lists/switches outside `src/providers/index.ts`. See "Provider-boundary guards" below. |
| Production build | `npm run build` | `build` | CSS concat, esbuild bundle, SDK patching, renderer-unsafe-unref guard. |
| Artifact smoke | `npm run check:artifacts` | `build` | Missing/empty artifacts, package/manifest version desync, missing `minAppVersion`, bundle-size budget. |

All CI jobs and the release workflow (`.github/workflows/release.yml`) run the
same Node major (22), declared as `"engines": { "node": ">=22" }` in
`package.json` — so the release bundle is built by the same toolchain CI
verified (aligned 2026-06-09; see
`docs/tech-debt/2026-06-07-release-artifact-reproducibility.md`).

Run the whole local set before pushing:

```bash
npm run lint && npm run check:loc && npm run check:quality && npm run typecheck && npm run test && npm run build && npm run check:artifacts
```

Optional, before opening a PR — surfaces fallow findings on changed files vs
`main` so review starts with signal already collected. Advisory; the blocking
counterpart is `npm run check:quality` — see "Fallow quality ratchet" below.

```bash
npm run quality:audit
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

## Fallow quality ratchet

`fallow` is a deterministic codebase-intelligence layer for TypeScript / JavaScript
([fallow-rs/fallow](https://github.com/fallow-rs/fallow)). It surfaces dead code,
duplication, complexity hotspots, and architecture-boundary violations as
**structured signal** for humans and agents.

Config lives in `.fallowrc.json` at the repo root. Cache and intermediate output
go to `.fallow/` (already in `.gitignore`). `src/style/**` is excluded (the CSS
files are concatenated by `scripts/build-css.mjs`, outside the TS import graph),
and `tslib` (`importHelpers` runtime for ts-jest) / `electron` (provided by
Obsidian's runtime) are declared in `ignoreDependencies`.

### The gate

`scripts/check-quality.mjs` (CI job `quality`) runs `fallow --format json` and
enforces a ratchet against `scripts/quality-baseline.json` — the same policy as
the LOC guard, applied to whole-repo metrics:

- **Counters may shrink but not grow**: dead-code issues, circular
  dependencies, re-export cycles, architecture boundary violations, clone
  groups, duplicated lines, functions above the complexity threshold,
  critical-severity complexity findings.
- **Floors may rise but not drop**: average maintainability.
- The three structural counters (`circularDependencies`, `reExportCycles`,
  `boundaryViolations`) are **0 and must stay 0**. The ratchet mechanics would
  allow bumping them like any other baseline, but treat that as an
  architecture decision (ADR territory), not a metric trade-off.
- When a PR improves a metric, lock the gain in:
  `npm run check:quality -- --update` and commit the baseline diff in the same
  PR. The guard prints a reminder when unlocked improvements exist.
- A deliberate regression (rare, reviewed trade-off) bumps the baseline the
  same way, justified in the PR.

The wrapper exists because fallow's own gate flags (`--fail-on-regression`,
`--min-score`) did not reliably drive the process exit code as of 2.91; the
JSON report is stable, so the ratchet parses that instead.

### Architecture boundaries (zones)

`.fallowrc.json` declares the layer architecture as fallow boundary zones with
explicit import rules, so `boundary_violations` is a meaningful gated metric
(enforced at 0 by the ratchet since 2026-06-10). The rules encode ADR 0001 and
the layer table in `CLAUDE.md`:

- `core` imports only `utils` at runtime (type-only edges to `app`/`i18n` are
  allowed — today a single event-map type in `PluginContext`).
- `features` never import provider internals; provider access goes through
  `ProviderRegistry` / `ProviderWorkspaceRegistry`. This is the machine-checked
  twin of the `no-restricted-imports` lint rule, and it also covers type-only
  imports, which the lint rule's per-file exemptions do not.
- Provider zones (`provider-claude`, `provider-codex`, `provider-cursor`,
  `provider-opencode`) may not import each other. Only `provider-opencode`
  may use the shared `acp` transport, and only `src/providers/index.ts`
  (the `provider-aggregator` zone) may import provider internals.
- `shared`, `utils`, and `i18n` stay leaf-ward: no imports from `features`,
  `providers`, or `app`.

Known looseness, deliberate for now: provider zones are allowed to import
`features` because the provider settings tabs reuse
`features/settings/ui/EnvironmentSettingsSection` / `McpSettingsManager` and
the `ProviderCustomModel` type. If those helpers move to `shared/`, tighten the
provider rules to drop `features` in the same PR.

### Advisory commands

| Command | What it does |
|---------|--------------|
| `npm run check:quality` | the CI ratchet gate (add `-- --update` to rewrite the baseline) |
| `npm run quality` | dead-code + dupes + health in one pass |
| `npm run quality:audit` | changed-files review vs `main` (use before opening a PR) |
| `npm run quality:health` | maintainability score, hotspots, prioritized refactor targets |
| `npm run quality:dead-code` | unused exports / files / deps only |
| `npm run quality:dupes` | clone families across `src/**` (tests excluded by config) |

History: the 2026-06-07 monitoring-only baseline was 72 dead-code issues,
8 clone groups, 800 functions above the complexity threshold, maintainability
90.2. On 2026-06-09 the false positives were configured away (CSS files,
provided deps), the remaining real findings (import cycles, clone groups) were
fixed, and the ratchet went live — `scripts/quality-baseline.json` is the
authoritative current bar.

## Next slices

Tracked here so the direction is explicit.

1. **Burn down the `warn` backlog, then ratchet.** Resolve function-health and
   staged `obsidianmd`/`no-explicit-any` warnings incrementally; each time a
   threshold reaches zero, tighten it (or promote the rule to `error`) so the
   gain can't regress. No big-bang refactor and no day-one CI block.
2. **Perf-gate wiring.** `tests/perf/*` are monitoring-only today
   (`docs/tech-debt/2026-06-07-perf-gates-blind-spots.md`); decide which
   scaling assertions graduate into a blocking job.
3. **Tighten the quality-ratchet floors.** The ratchet freezes today's debt;
   the complexity backlog (`complexFunctions`, `criticalComplexity` in
   `scripts/quality-baseline.json`) still has to be burned down hotspot by
   hotspot (`npm run quality:health` prioritizes targets). Each refactor PR
   that moves a metric should commit the tightened baseline so the gain is
   locked in.
4. **Move the shared settings-UI helpers out of `features/`** so the provider
   boundary zones can drop their `features` allowance — see "Architecture
   boundaries (zones)" above.

Done: provider-boundary regression tests and the no-new-provider-hardcoded-list
guard (remediation item 5 of the tech debt) — see "Provider-boundary guards".
Done 2026-06-09: fallow graduated from monitoring to a blocking ratchet gate
(`npm run check:quality`, CI job `quality`) — see "Fallow quality ratchet".
Done 2026-06-10: dependency-cycle budget closed at zero — fallow's type-aware,
barrel-aware graph found no genuine cycles (the 2026-06-07 Tarjan numbers were
type-only/barrel artifacts), so `circularDependencies`, `reExportCycles`, and
`boundaryViolations` joined the ratchet pinned at 0 instead of a grandfathered
budget. See `docs/tech-debt/2026-06-07-import-cycle-budget.md`.
