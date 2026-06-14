---
title: "Quality integration guide"
date: 2026-06-14
status: active
scope: build-ci
---

# Quality integration guide

How to work with Claudian's quality harness — the deterministic evidence layer
([fallow](https://github.com/fallow-rs/fallow)) plus the lint, style, and
size gates (ESLint + LOC guard). This is the onboarding / usage / extension
companion; the authoritative **gate catalogue**, ratchet mechanics, and
campaign history live in
[`quality-gates.md`](quality-gates.md). When the two disagree, that document
wins on gate behavior and this one wins on how to drive it.

This guide is adapted from a generic "Fallow Integration Guide". Most of that
guide's setup steps are **already done here** — fallow is installed, configured,
scripted, and gated in CI. So this document focuses on (a) how the harness is
actually wired, (b) the ESLint half the generic guide doesn't cover, and (c)
the handful of places Claudian deliberately diverges from the generic template
and why. The divergences are summarized in
[one table](#divergences-from-the-generic-fallow-guide) near the end — read that
first if you already know fallow.

---

## The harness at a glance

Two evidence sources, one bar. Each has a **blocking** gate (fails CI) and
**advisory** commands (signal, never block).

| Source | Owns | Blocking gate | CI job | Advisory |
|--------|------|---------------|--------|----------|
| **fallow** | dead code, duplication, complexity, maintainability, architecture-boundary zones | `npm run check:quality` (whole-repo metric ratchet vs `scripts/quality-baseline.json`) | `quality` | `npm run quality`, `quality:audit`, `quality:health`, `quality:dead-code`, `quality:dupes` |
| **ESLint** | correctness, security (no raw HTML, no `console`), i18n, import boundaries, import sort, function health, Obsidian API hygiene | `npm run lint` (**error**-level rules only) | `lint` | `warn`-tier rules (print, never fail — see [severity policy](#eslint-the-severity-policy)) |
| **LOC guard** | per-file size ratchet for `src/**/*.ts` | `npm run check:loc` | `lint` | `-- --update` to re-lock the baseline |

The whole local set, before pushing (also in
[`quality-gates.md`](quality-gates.md)):

```bash
npm run lint && npm run check:loc && npm run check:quality && npm run typecheck && npm run test && npm run build && npm run check:artifacts
```

> **Coverage caveat (read before running `check:quality`):** run the ratchet
> with **no `coverage/` directory present** — a stray one flips fallow's CRAP
> weighting and spikes `criticalComplexity`. Run `npm run test:coverage`
> **last**. Details in [Divergence 3](#divergence-3-run-the-ratchet-with-coverage-absent).

---

## fallow: how it's wired here

Installed as a devDependency (`fallow@^2.91.0`). Config is **`.fallowrc.json`**
at the repo root (plain JSON — see
[Divergence 1](#divergence-1-config-is-plain-json-not-jsonc)). Cache and
intermediate output land in `.fallow/`, which is git-ignored.

What the config does:

| Field | Value | Why |
|-------|-------|-----|
| `entry` | `["src/main.ts"]` | The esbuild bundle entry. `package.json` `main` is the built `main.js`, so auto-detection can't see the TS source root — declare it or the whole graph reads as unused. |
| `ignorePatterns` | `docs`, `.context`, `dev`, `scripts`, `.fallow`, `coverage`, `main.js`, `styles.css`, `src/style/**` | `src/style/**` is concatenated by `scripts/build-css.mjs`, outside the TS import graph; the rest are non-source or generated. |
| `ignoreDependencies` | `tslib`, `electron` | `tslib` is the `importHelpers` runtime for ts-jest; `electron` is provided by Obsidian's runtime. Neither is a real unused dep. |
| `duplicates.minOccurrences` | `2` (tests ignored) | Every copy-paste **pair** counts against the clone ratchet, not just triples. |
| `boundaries` | zones + rules (the layer architecture) | Machine-checks ADR 0001. See [Divergence 2](#divergence-2-boundary-zones-are-on-on-purpose). |
| `rules.unused-dependencies` | `"warn"` | Kept visible but not verdict-driving (the generic guide's "downgrade a noisy rule" pattern). |

### The scripts

| Script | Command | When |
|--------|---------|------|
| `npm run quality` | `fallow` | Full sweep (dead-code + dupes + health). Before a big refactor, or to read the current picture. |
| `npm run quality:audit` | `fallow audit` | Advisory changed-files review. Before opening a PR. (See [Divergence 5](#divergence-5-the-advisory-audit-base-is-unpinned).) |
| `npm run quality:health` | `fallow health --score --hotspots --targets` | Maintainability score + prioritized refactor targets. |
| `npm run quality:dead-code` | `fallow dead-code` | Unused files / exports / deps only. |
| `npm run quality:dupes` | `fallow dupes` | Clone families across `src/**`. |
| `npm run check:quality` | `node scripts/check-quality.mjs` | **The blocking gate.** Add `-- --update` to re-lock the baseline. |

### The ratchet (`check:quality`)

`scripts/check-quality.mjs` runs `fallow --quiet --format json` and enforces a
ratchet against `scripts/quality-baseline.json` — the same policy as the LOC
guard, applied to whole-repo metrics:

- **Counters shrink-only:** `deadCodeIssues`, `cloneGroups`, `duplicatedLines`,
  `complexFunctions`, `criticalComplexity`. May fall freely; may not grow past
  baseline.
- **Floors rise-only:** `averageMaintainability` (tolerates ±0.05 float noise).
- **Structural counters pinned at 0:** `circularDependencies`, `reExportCycles`,
  `boundaryViolations`. The ratchet mechanics would let you bump them, but treat
  any bump as an architecture decision (ADR territory), not a metric trade-off.
- **Lock improvements in the same PR:** when a metric improves, run
  `npm run check:quality -- --update` and commit the baseline diff. The guard
  prints a reminder when unlocked gains exist; it does not fail on them.

A deliberate, reviewed regression bumps the baseline the same way, justified in
the PR.

> The wrapper exists because fallow's own gate flags
> (`--fail-on-regression`, `--min-score`) did not reliably drive the process
> exit code as of 2.91; the JSON report is stable, so the ratchet parses that.

---

## ESLint: the severity policy

Config is `eslint.config.mjs` (flat config). `npm run lint` lints
`{src,tests}/**/*.ts`; `npm run lint:fix` applies autofixes.

The core convention is a **two-tier severity policy**:

- **`error`** — must-not-regress rules. `npm run lint` exits non-zero on any of
  them, so they block CI.
- **`warn`** — a staging tier. CI does **not** pass `--max-warnings`, so warnings
  print but never fail the build. This is how a noisy new rule lands without
  blocking unrelated work on day one.

This is the lint analogue of the fallow ratchet: **stage** a new rule at `warn`,
**burn** its backlog to zero, **promote** it to `error` to lock the gain, and
**record** the promotion in [`quality-gates.md`](quality-gates.md) §
"Lint severity policy". As of the latest campaign the `warn` tier is **empty** —
every staged rule has been promoted — so the lint gate is currently all-error.
(`eslint --print-config` confirms no rule sits at `warn`.) The tier stays
available for the next rule.

The `error`-tier rules, by family:

| Family | Rules (scope) | Guards |
|--------|---------------|--------|
| Security | `no-restricted-syntax` banning `innerHTML`/`outerHTML`/`insertAdjacentHTML` assignment (`src/**`) | XSS in the streaming chat UI — build DOM with `createEl`/`createDiv`/`createSpan`/`setText`/`.empty()` or `MarkdownRenderer`. |
| Correctness | `no-console` (`src/**`) | No `console.*` in production code. |
| i18n | `no-restricted-syntax` banning literal/template strings in `new Notice(...)` (`src/**`) | Every user-visible notice routes through `t('key')` so the 10 locales can override it. |
| Boundaries | `no-restricted-imports` blocking `providers/<id>/**` reach-in (`src/**`, except provider internals + `src/providers/index.ts`) | The ESLint twin of fallow's boundary zones — see [Divergence 2](#divergence-2-boundary-zones-are-on-on-purpose). |
| Hygiene | `no-unused-vars`, `no-explicit-any` (`src` only; tests keep `any` for mocks), `consistent-type-imports`, `simple-import-sort/{imports,exports}` | Type regressions, dead bindings, import churn. |
| Function health | `complexity` ≤ 25, `max-lines-per-function` ≤ 200, `max-params` ≤ 6, `max-depth` ≤ 5 (`src/**`) | Function-level signal the whole-file LOC guard can't see. |
| Obsidian API | the `obsidianmd/*` plugin-correctness set (`src/**`) | Obsidian-specific footguns (detached leaves, static styles, unsupported API, sentence-case UI, …). |
| Tests | `jest/*` recommended + `expect-expect`, `no-disabled-tests`, `no-commented-out-tests` (`tests/**`) | A test with no assertion, a committed `.skip`, or a commented-out test now fails CI. |

### LOC guard

`npm run check:loc` (`scripts/check-loc.mjs`) ratchets nonblank line count for
every `src/**/*.ts` file against `scripts/loc-baseline.json` (cap **500**). New
files over the cap fail; grandfathered hotspots may shrink but never grow; stale
allowlist entries fail. Regenerate (preserving `reason` text) with
`npm run check:loc -- --update`. Runs in the `lint` CI job.

### Adding or tightening a lint rule

1. Add the rule at `warn` in `eslint.config.mjs`.
2. Run `npm run lint`, read the backlog, fix offenders (decompose — never blanket
   `eslint-disable`).
3. When the count hits zero, flip the rule to `error`.
4. Record the promotion in [`quality-gates.md`](quality-gates.md) §
   "Lint severity policy" so the history stays legible.

### Suppressions

Use a **narrow** `// eslint-disable-next-line <rule>` with a justification
comment — never a blanket file/rule disable. Same discipline as fallow's
`fallow-ignore-next-line <rule>` directives: always say what constraint forces
it and what the plan is. Track intentional suppressions as tech debt so they get
revisited rather than accumulated.

---

## CI (every PR)

Jobs in `.github/workflows/ci.yml`, all on Node 22:

| Job | Runs | Gates |
|-----|------|-------|
| `lint` | `npm run lint` + `npm run check:loc` | Error-level lint + file-size ratchet. |
| `quality` | `npm run check:quality` | fallow whole-repo metric ratchet. **No coverage artifact** — deliberate ([Divergence 3](#divergence-3-run-the-ratchet-with-coverage-absent)). |
| `typecheck` | `npm run typecheck` | Type regressions. |
| `test` | `npm run test` (Linux **and** Windows) | Behavior on both path/spawn targets. |
| `coverage` | `npm run test:coverage` | `coverageThreshold` floors. |
| `perf` | `npm run test:perf` | Deterministic scaling guards (counts, never timings). |
| `build` | `npm run build` + `npm run check:artifacts` | Production bundle + artifact smoke. |

---

## Agents

Coding agents (Claude Code, etc.) should treat the same gates as the human
workflow, plus fallow's machine-readable surfaces:

- **Run the gate, not just the sweep.** `npm run check:quality` is the bar;
  `npm run quality` / `quality:health` are for reading detail. Run
  `npm run quality:audit` before requesting review for a changed-files verdict.
- **JSON for programmatic use:** `fallow <cmd> --format json --quiet`. Issues
  carry an `actions` array with `auto_fixable` flags — check those before
  hand-fixing.
- **Caveats specific to this repo** (do not "fix" these — they are intentional):
  - Run `check:quality` with **`coverage/` absent**
    ([Divergence 3](#divergence-3-run-the-ratchet-with-coverage-absent)).
  - The boundary constraint is enforced **twice** (ESLint + fallow zones) **on
    purpose** ([Divergence 2](#divergence-2-boundary-zones-are-on-on-purpose)) —
    don't collapse it to one source.
  - `unused-dependencies` is `warn` (visible, not gating); the gate is the
    ratchet, not the raw `fallow` exit code.
  - Lint `warn`s never fail CI — promoting a rule to `error` is what enforces it.

### Optional, not yet wired here

The generic guide registers an MCP server and a pointer skill. **Claudian does
not ship these today.** Add them only if the team wants in-session agent access;
they are not required for the gates to work.

- **MCP server** — create `.mcp.json` registering `npx fallow-mcp` (stdio,
  version-matched to the installed fallow). It exposes read-only analysis tools
  **and** a write-capable `fix_apply` that edits the working tree. If agents must
  not write unsupervised, deny `fix_apply` in `.claude/settings.json`.
- **Pointer skill** — `.claude/skills/fallow/SKILL.md` as a thin pointer to the
  version-matched upstream skill at `node_modules/fallow/skills/fallow/SKILL.md`,
  carrying the repo caveats above. Never copy the upstream body in — the pointer
  pattern is what stops it drifting from the installed CLI version.

---

## Divergences from the generic fallow guide

The generic template assumes a greenfield fallow setup whose only gate is the
changed-code audit. Claudian's harness is older and stricter, so it diverges in
five deliberate places. Each is documented below; don't "correct" them toward
the generic template without reading the rationale.

| # | Generic guide says | Claudian does | Why |
|---|--------------------|---------------|-----|
| 1 | `.fallowrc.jsonc` with inline comment rationale | `.fallowrc.json` (plain JSON) | Rationale lives in `quality-gates.md`, not inline. |
| 2 | Don't double-enforce boundaries — let the linter own them | Enforce in **both** ESLint and fallow zones | fallow zones also catch **type-only** edges the lint exemptions miss, and encode ADR 0001. |
| 3 | Generate coverage **before** the audit | Run the ratchet with coverage **absent** | A present `coverage/` flips CRAP weighting and spikes `criticalComplexity`. |
| 4 | The PR gate is `fallow audit --base origin/main` (advisory → blocking) | The PR gate is a whole-repo **ratchet** (`check:quality`); `audit` stays advisory | fallow's gate flags didn't drive the exit code reliably at 2.91; the ratchet locks whole-repo debt deterministically. |
| 5 | Pin `--base origin/main` in the `quality:audit` script | `quality:audit` is unpinned (`fallow audit`) | Known gap, low impact — the blocking gate is the ratchet, so `audit` is purely advisory. |

### Divergence 1: config is plain JSON, not JSONC

The repo uses `.fallowrc.json`. There are no inline comments; the reasoning
behind each field is documented here and in `quality-gates.md` instead. (The
table in [fallow: how it's wired here](#fallow-how-its-wired-here) is the
inline-comment substitute.)

### Divergence 2: boundary zones are on, on purpose

The generic guide warns against enforcing the same boundary constraint in two
tools ("two sources of truth is a maintenance trap"). Claudian does it anyway,
deliberately, because the two checks are **not** redundant:

- ESLint `no-restricted-imports` blocks `features`/etc. from reaching into
  `src/providers/<id>/**`, but it carries **per-file exemptions** and does not
  see **type-only** imports.
- fallow's boundary `zones`/`rules` are the machine-checked twin: they cover the
  full ADR 0001 layer architecture (`core` → `utils` only, providers may not
  import each other or `features`, `shared`/`utils`/`i18n` stay leaf-ward, …)
  **including type-only edges**, and `boundaryViolations` is pinned at 0 by the
  ratchet.

They are kept in sync by design. If you change one, change the other. See
[`quality-gates.md`](quality-gates.md) § "Architecture boundaries (zones)" and
ADR 0001 (`docs/adr/0001-transport-agnostic-provider-seam.md`).

### Divergence 3: run the ratchet with coverage absent

This is the most important operational gotcha. The generic guide recommends
generating Istanbul coverage before the fallow audit so CRAP is exact. In
Claudian the **opposite** holds for the ratchet:

- With no `coverage/` directory, fallow scores complexity as
  `static_estimated`.
- A stray `coverage/` directory flips it to Istanbul-weighted CRAP, which spikes
  `severity_critical_count` (`criticalComplexity`) from **0 to ~24** and breaks
  the gate against a baseline measured without it.

CI's `quality` job has **no** coverage step, so to match it: always run
`npm run check:quality` — and lock any baseline — with `coverage/` **absent**,
and run `npm run test:coverage` **last**. Both `coverage/` and `.fallow/` are
git-ignored. (History: `quality-gates.md`, quality campaign run 9.)

### Divergence 4: the gate is a ratchet, not the audit

The generic guide's blocking check is `fallow audit` on the changed-code diff.
Claudian gates on **whole-repo** metrics via `scripts/check-quality.mjs`
(CI job `quality`) instead — see [The ratchet](#the-ratchet-checkquality). This
freezes total debt and drives it down PR by PR, rather than only judging the
diff. `quality:audit` is still useful as an advisory pre-PR pass, but it is not
the gate.

### Divergence 5: the advisory audit base is unpinned

The script is `fallow audit` (no `--base origin/main`), so on a pushed feature
branch it diffs against the tracked upstream. Because the **blocking** gate is
the ratchet, this is a low-impact gap. If you want the advisory audit to mirror
a CI-style diff against `main`, run it explicitly:

```bash
npx fallow audit --base origin/main
```

---

## Verification checklist

After any change to the harness (config, scripts, baseline, rules):

```bash
# 1. Full local fallow sweep
npm run quality

# 2. The actual blocking gate — coverage/ must be ABSENT (Divergence 3)
npm run check:quality

# 3. Lint + file-size ratchet
npm run lint && npm run check:loc

# 4. Advisory changed-files audit (pin --base for a main-style diff)
npx fallow audit --base origin/main
```

If you wired the optional MCP server / skill, also confirm `npx fallow-mcp`
starts cleanly and `node_modules/fallow/skills/fallow/SKILL.md` resolves.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `criticalComplexity` jumped 0 → ~24 | A `coverage/` directory is present. Remove it and re-run; run `npm run test:coverage` last. ([Divergence 3](#divergence-3-run-the-ratchet-with-coverage-absent)) |
| Ratchet failed but I didn't add debt | Check for a stray `coverage/` first. Otherwise a metric genuinely grew — run `npm run quality` for detail. Lock real improvements with `npm run check:quality -- --update`. |
| `boundaryViolations` > 0 | A cross-zone import slipped in. Fix the import; do **not** bump the baseline (it's an architecture decision). The matching ESLint `no-restricted-imports` error usually points at the same line. |
| "Unused file" false positive | Add the entry point to `entry` in `.fallowrc.json` (already declares `src/main.ts`). |
| Unused dependency reported | It's `warn` here (`unused-dependencies`), so it won't gate. If it's a genuine runtime/provided dep like `tslib`/`electron`, add it to `ignoreDependencies`. |
| A lint `warn` isn't failing CI | Expected — CI doesn't pass `--max-warnings`. Promote the rule to `error` to enforce it ([severity policy](#eslint-the-severity-policy)). |
| `fallow audit` reports findings in files I only touched | With new-only attribution, inherited findings show as **context** (`introduced: false`) and don't fail. Only `introduced: true` findings are yours to fix. |

---

## See also

- [`quality-gates.md`](quality-gates.md) — the authoritative gate catalogue,
  ratchet mechanics, lint severity policy, and quality-campaign history.
- `docs/adr/0001-transport-agnostic-provider-seam.md` — the provider-boundary
  architecture that the ESLint import rule and fallow zones both enforce.
- `docs/tech-debt/2026-06-07-agentic-quality-gates.md` — the tech-debt record
  that motivated the machine-enforced gates.
