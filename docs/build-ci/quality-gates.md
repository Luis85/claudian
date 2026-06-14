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
| Perf scaling guards | `npm run test:perf` | `perf` | A hot path's cost scaling with unbounded input instead of its bounded window (render window, per-turn tools, slot cap). Deterministic count assertions only — timings stay report-only. |
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

The function-health `warn` backlog is now cleared. `complexity` 25 and
`max-lines-per-function` 200 were promoted to `error` on 2026-06-13 (quality
campaign run 7) once their last 10 offenders were decomposed — see the
promotion note below. Whole-file size is already a hard gate via the LOC
guard; the function-health rules add the function-level signal that file-level
LOC can't see. As of run 13, the last `warn`-tier rules were promoted:
`jest/expect-expect` (the staged-backlog rule) plus `jest/no-disabled-tests` and
`jest/no-commented-out-tests`, which ship at `warn` from the jest-recommended
preset (`...jestRecommended.rules`). `eslint --print-config` now reports **no
rule at `warn`** for any file, so the lint gate is genuinely all-error — which
matters because CI does not pass `--max-warnings`, so a `warn` rule would
otherwise never fail the build. The `warn` tier stays available for staging a
future rule but is currently empty.

Promoted to `error` on 2026-06-10, after their backlogs reached zero: the
staged `obsidianmd/*` set, `@typescript-eslint/no-explicit-any` (src only;
tests keep their mocking override), `max-params` 6, and `max-depth` 5.
Promoted to `error` on 2026-06-13 (quality campaign run 7), after their
backlog reached zero: `complexity` 25 and `max-lines-per-function` 200. The
final 10 offenders were cleared by genuine decomposition (lookup-table
dispatch and sibling-module extraction, never `eslint-disable`), which also
dropped `complexFunctions` 271 → 264 and `duplicatedLines` 1804 → 1790 while
holding `criticalComplexity` at 0.
Promoted to `error` on 2026-06-13 (quality campaign run 13): the remaining
test-suite `warn` rules — `jest/expect-expect` (the staged-backlog rule) and the
jest-recommended preset's `jest/no-disabled-tests` + `jest/no-commented-out-tests`.
All three had zero offenders, so the promotions just lock the gain: a test with no
assertion (outside the allowlisted `assertFunctionNames` wrappers), or a committed
`.skip`/commented-out test, now fails CI instead of printing a warning.
`eslint --print-config` confirms no rule remains at `warn`.

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
  `provider-opencode`) may not import each other — **and may not import
  `features` at all** (closed 2026-06-10: the settings-UI helpers the provider
  tabs reuse moved to `shared/settings/`, and the `ProviderCustomModel` type
  to `core/types/settings`). Only `provider-opencode` may use the shared `acp`
  transport, and only `src/providers/index.ts` (the `provider-aggregator`
  zone) may import provider internals.
- `shared`, `utils`, and `i18n` stay leaf-ward: no imports from `features`,
  `providers`, or `app`.

The original (2026-06-10 morning) zone set allowed provider zones to import
`features` because the provider settings tabs reused
`features/settings/ui/EnvironmentSettingsSection` / `McpSettingsManager` and
the `ProviderCustomModel` type. Those helpers now live in `shared/settings/`
(type in `core/types/settings`), and the allowance is gone.

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

1. **Burn down the `warn` backlog, then ratchet — DONE.** Every staged
   function-health / test rule reached zero offenders and was promoted to
   `error`: `complexity` 25 + `max-lines-per-function` 200 (run 7), and the
   test-suite rules `jest/expect-expect` + `jest/no-disabled-tests` +
   `jest/no-commented-out-tests` (run 13). No `warn`-tier rules remain
   (`eslint --print-config` confirms); the lint gate is now all-error.
2. **Tighten the quality-ratchet floors.** The ratchet freezes today's debt and
   is driven down each PR. After runs 8–15, `cloneGroups` (32) and
   `duplicatedLines` (803) have shed the clean same-file/same-zone families, the
   boundary-legal cross-zone settings/spawn ones, and the subprocess-lifecycle
   clone (extracted to `core/transport/` in run 15); what remains is mostly
   entangled provider↔provider runtime clones (tool normalization, `ChatRuntime`)
   whose only shared home is `core/` — diminishing, judgment-call payoff.
   `complexFunctions` (236) is burned down hotspot by hotspot
   (`npm run quality:health`), but the metric folds in coverage-weighted CRAP, so
   the remaining lower-cognitive tail yields ever-smaller gate deltas. Each
   refactor PR that moves a metric commits the tightened baseline so the gain is
   locked in.
   **`criticalComplexity` reached 0 in run 6 (was 59 across the campaign)** — it
   is now effectively a must-stay-0 counter like the structural metrics; any
   new critical-severity function should be split before merge rather than
   bumping the baseline.
Done: provider-boundary regression tests and the no-new-provider-hardcoded-list
guard (remediation item 5 of the tech debt) — see "Provider-boundary guards".
Done 2026-06-09: fallow graduated from monitoring to a blocking ratchet gate
(`npm run check:quality`, CI job `quality`) — see "Fallow quality ratchet".
Done 2026-06-10: dependency-cycle budget closed at zero — fallow's type-aware,
barrel-aware graph found no genuine cycles (the 2026-06-07 Tarjan numbers were
type-only/barrel artifacts), so `circularDependencies`, `reExportCycles`, and
`boundaryViolations` joined the ratchet pinned at 0 instead of a grandfathered
budget. See `docs/tech-debt/2026-06-07-import-cycle-budget.md`.
Done 2026-06-10 (second pass): the provider→`features` zone allowance closed —
shared settings-UI helpers moved to `shared/settings/`, so provider zones now
import only `app`/`core`/`shared`/`utils`/`i18n` (+ `acp` for Opencode).
Done 2026-06-10 (third pass): perf scaling guards graduated into a blocking CI
job (`perf`, `npm run test:perf`) — gateable because every assertion is a
deterministic count, never a timing; timings remain report-only monitoring.
See `docs/tech-debt/2026-06-07-perf-gates-blind-spots.md`. Same pass: the
duplication detector tightened from `minOccurrences: 3` (which reported zero
groups) to `2`, so every new copy-paste pair now counts against the
`cloneGroups` ratchet; the worst ~37 pair-groups were consolidated before the
flip and the remainder grandfathered in the baseline. Same pass: lint rules
whose backlogs hit zero were promoted to `error` (staged `obsidianmd/*`,
`no-explicit-any`, `max-params`, `max-depth`) — see "Lint severity policy".
Done 2026-06-13 (quality campaign run 7): the function-health `warn` rules
`complexity` 25 and `max-lines-per-function` 200 reached zero offenders and
were promoted to `error`. The last 10 offenders were decomposed (lookup-table
dispatch, sibling-module extraction) across 10 files in 6 zones, which also
moved `complexFunctions` 271 → 264 and `duplicatedLines` 1804 → 1790 with
`criticalComplexity` held at 0 — see "Lint severity policy".
Done 2026-06-13 (quality campaign run 8): clone-group reduction. Same-file and
same-zone duplicated blocks were extracted into shared siblings/helpers across
chat rendering, chat/tasks controllers, codex settings UI, shared dropdowns,
`i18n`/`path`/binary-path utils, and the four provider runtimes, dropping
`cloneGroups` 68 → 42 and `duplicatedLines` 1790 → 1063 while holding every
structural counter at 0 (`complexFunctions` 264 → 263, maintainability
90.2 → 90.3). Cross-zone clones (provider↔provider, feature↔provider) that would
only dedupe through an awkward `shared/`/`core/` module were deliberately left.
Grandfathered hotspots shrank by extracting out to siblings rather than editing
in place. A latent `MessageRenderer` ↔ `windowedRenderSetup` import cycle created
during extraction was broken by relocating the windowing primitives
(`RENDER_WINDOW_SIZE`, `windowStartIndex`) into the windowing module, keeping
`circularDependencies` at 0.
Done 2026-06-13 (quality campaign run 9): complexity decomposition. High-cognitive
functions across `utils`, `core`, the Claude/Cursor/Opencode providers, `app`, and
`shared/settings` were split into small, behavior-preserving helpers (parents reduced
to thin orchestrators), dropping `complexFunctions` 263 → 254 with `criticalComplexity`
held at 0, maintainability 90.3, and clones/structural counters unchanged. Two gotchas
worth remembering: the gated `complexFunctions` (fallow's `functions_above_threshold`)
counts cyclomatic≥20 **OR** cognitive≥15 **OR CRAP≥30**, and CRAP is coverage-weighted —
so (a) the net count drops less than the number of functions fixed (a decomposed helper
can re-trip CRAP), and (b) a stray `coverage/` directory flips fallow from
`static_estimated` to istanbul coverage, which spikes `severity_critical_count`
(`criticalComplexity`) from 0 to ~24. **Always run `npm run check:quality` — and lock the
baseline — with `coverage/` absent** (that matches CI's `quality` job, which has no
coverage artifact); run `npm run test:coverage` last and never lock a baseline while
`coverage/` exists.
Done 2026-06-13 (quality campaign run 10): complexity decomposition, second pass.
Sixteen high-cognitive functions across chat rendering/streaming/services, the Claude
provider, Cursor, core, tasks, utils, and `shared/settings` were decomposed into small
helpers — including the five grandfathered `feat:chat` hotspots deferred in run 9
(`renderApplyPatchExpanded`, `hasVisibleContent`, `handleRegularToolUse`,
`handleTaskToolUse`, `renderQuestionTab`), extracted out to siblings while the GF files
shrank. `complexFunctions` 254 → 239 (a bigger delta than run 9's −9, by holding every new
helper to cyclomatic ~≤6 so it stays under CRAP≥30 — the run-9 lesson applied), with
`criticalComplexity` 0, maintainability 90.3, and clones/structural counters unchanged.
Instance-`this`-coupled blocks that could only be private methods (not pure siblings) were
kept in place — a small LOC bump on a GF file is acceptable when it avoids threading many
fields through free functions.
Done 2026-06-13 (quality campaign run 11): cross-zone clone consolidation into `shared/`.
The provider/feature clones that boundary rules forbid deduping in place (providers↛each-other,
features↛providers) were lifted into `shared/settings/` modules imported by both sides:
`customModelsSetting` (Claude + Codex settings tabs — the 86-line headliner, parameterized by
each provider's `update*`/`reconcile*` hooks plus Codex's optional inactive-projection),
`vaultAgentListPanel` (Codex subagent + Opencode agent list rendering; `codexListPanel` became
a re-export shim), and the editor-modal `addIconPickerRow` in `nameDescriptionRows` (quick-action
+ work-order template modals). `cloneGroups` 42 → 35, `duplicatedLines` 1063 → 869, with a bonus
`complexFunctions` 239 → 237 (the headliner extraction thinned each tab's `render`), and
`criticalComplexity`/maintainability/structural counters all held. Cross-zone runtime clones
(subprocess spawn, tool normalization, ChatRuntime) were left for a dedicated design pass —
their only shared home is `core/`, and the shared module would be more invasive than the win.
Done 2026-06-13 (quality campaign run 12a): loc-baseline tidy. `npm run check:loc -- --update`
re-locked the 27 grandfathered hotspots to their current size after runs 7–11 shrank many of
them — 19 entries tightened (e.g. `CodexHistoryStore` 1406→746, `ClaudianSettings` 844→526,
`WorkOrderDetailModal` 953→787, `MessageRenderer` 1208→1061), `reason` text preserved, none
grew, none crossed the 500 cap. Pure ratchet tightening, shipped standalone — a full regen
pulls cumulative shrinkage from unrelated files, so it stays out of feature PRs.
Done 2026-06-13 (quality campaign run 12b): cross-zone runtime-clone design pass. The
Windows batch-shim spawn logic duplicated between `CodexAppServerProcess` (provider-codex)
and `cursorWindowsSpawn` (provider-cursor) — `requiresWindowsShellQuoting`,
`quoteWindowsShellArgument`, and the cmd.exe-wrapping block — is genuinely provider-neutral
platform code, so it moved to `utils/windowsSpawn.ts` (`wrapWindowsCmdShim` owns the *how*;
each provider's resolver keeps its own *when* — `.cmd` vs `.cmd`/`.bat`, env threading).
Boundary-legal (providers → utils), with a dedicated `windowsSpawn` unit spec added.
`cloneGroups` 35 → 33, `duplicatedLines` 869 → 819, structural counters held at 0. This is the
"design pass" the run-11 note deferred; the remaining cross-zone runtime clones (tool
normalization, ChatRuntime) are more entangled with provider-specific shapes and were left.
Done 2026-06-13 (quality campaign run 13): lint-severity policy completed + tech-debt docs
refreshed. The last `warn`-tier rules were promoted to `error` — `jest/expect-expect` plus
the jest-recommended preset's `jest/no-disabled-tests` and `jest/no-commented-out-tests` (all
zero-offender) — so `eslint --print-config` now shows no rule at `warn` and the lint gate is
all-error (a committed `.skip`/commented-out test, or a test with no assertion, now fails CI). The
`docs/tech-debt/2026-06-07-agentic-quality-gates.md` debt note was moved `in-progress → done`
(every remediation item it tracked has shipped: the ratchet gate, the structural/boundary
counters at 0, the LOC guard, perf gates, and the full lint-policy promotion). No metric
counters moved this run — it is a policy-lock + documentation-accuracy pass.
Done 2026-06-13 (quality campaign run 14): split the two oversized test files (oversized-modules
remediation item 5, now `done`). `Tab.test.ts` (3,673 LOC / 178 tests) → `tabTestKit` + 4
behavior-surface siblings (lifecycle/wiring/model/fork); `ClaudianService.test.ts` (3,127 LOC /
204 tests) → `claudianServiceTestKit` + 5 siblings. The 382 tests are preserved exactly (repo
stays at 8,493), with a shared per-file kit of pure factories/fixtures (ts-jest hoisting accepts
imported `createMock*` inside `jest.mock` factories; the per-file mock blocks repeat freely since
tests are excluded from the clone gate). `complexFunctions` 237 → 236 (incidental), all other
counters held. Test files are not LOC- or clone-gated, so this is a maintainability/navigability
win rather than a ratcheted-metric move.
Done 2026-06-13 (quality campaign run 15): shared-transport process helper (ADR-0001 Move 2,
step 1; the CON-1/2/3 prerequisites had already shipped). Extracted `core/transport/AgentSubprocess`
— spawn, 8 KB stderr ring buffer, liveness, a normalized `onClose`, and the hardened
SIGTERM→SIGKILL→give-up `shutdown()` (one tested copy of the CON-2 teardown). `CodexAppServerProcess`
(codex) and `AcpSubprocess` (opencode) are now thin adapters that keep their own public contracts
(`onExit(code,signal)` / `onClose(error?)`) and provider-native launch details (Codex's Windows
`.cmd`-shim resolution); Codex gained free stderr diagnostics. Boundary-clean (`core/` → node +
`utils`; providers → `core/`), behavior-preserving (existing adapter + consumer suites pass), with
a new `AgentSubprocess` spec. Incidentally dropped the cross-zone `shutdown()` clone: `cloneGroups`
33 → 32, `duplicatedLines` 819 → 803; complexFunctions/structural counters held. The optional
JSON-RPC client (step 2) is deferred.
Done 2026-06-14 (quality campaign run 16): shared-transport JSON-RPC client (ADR-0001 Move 2,
step 2 — completes the `shared-transport-extraction` debt, now `done`). Extracted
`core/transport/JsonRpcStdioClient` — request/response correlation, timeouts + abort,
notification/server-request routing, line framing, and pending-request rejection on close/dispose,
over a `JsonRpcMessageStreams` abstraction. `AcpJsonRpcTransport` was already provider-agnostic so it
became a re-export of the core client (zero Opencode-consumer churn); `CodexRpcTransport` is a thin
adapter that bridges the Codex subprocess and keeps its API (server requests still receive the id).
Capability-aware (ACP abort/typed-errors, Codex id-passing) with no provider forced through a fake
common transport. Behavior-preserving — transport unit + consumer suites pass unchanged; new
`JsonRpcStdioClient` spec covers pending-request rejection, timeout, abort, and routing. No gated
metric moved (the two transports weren't a tracked clone): an architectural dedup, counters held at
32 / 803 / 236 / 0.
