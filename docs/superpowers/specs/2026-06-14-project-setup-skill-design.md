---
title: Project-setup skill
date: 2026-06-14
status: shipped
scope: .claude/skills/project-setup
---

# Project-setup skill — design

> **Status — as built (shipped in PR #97).** Approach A was implemented under
> `.claude/skills/project-setup/` and hardened across many review rounds (the
> full `node:test` suite green + a live CLI smoke). Task-level deltas between this
> design and the shipped engine — each with its rationale — live in the
> **"As-built notes"** sections of the three plan docs
> (`docs/superpowers/plans/2026-06-14-project-setup-{engine-core,harness-templates,user-facing-skill}.md`);
> the code and those notes are authoritative where they differ from this spec.
> The design-level decisions that changed during implementation, and **why**:
>
> - **The `Action` `writeFile` mode union dropped `create`** — only
>   `skip-if-exists` and `overwrite-backup` shipped. *Why:* no planner needed a
>   third mode, and silent-overwrite-without-backup was a footgun the two
>   remaining modes already cover safely.
> - **`project-setup.report.json` records `{ engine, options }` only** — not the
>   "every action taken" log this spec's *Determinism and safety model* implies.
>   *Why:* the action list and detected state change once the harness installs
>   deps, which rewrote the report on every re-apply and broke the "second `apply`
>   is a no-op" idempotency contract; recording the resolved `options` keeps the
>   artifact stable. (Pinned versions still ship — they live in the generated
>   `package.json`, not the report.)
> - **`packageManager` / `testFramework` / `typescript` resolve from `detect()`**
>   when the answer is unset (the `answers.json` defaults are `null`/`null`/`null`,
>   not the illustrative literals shown under *Options object* below). *Why:* a
>   brownfield repo's real toolchain (pnpm / Vitest / plain JS) must win over the
>   greenfield defaults instead of being silently overwritten.
> - **The dirty-tree warning and `--yes` confirmation live in the SKILL.md
>   orchestration layer, not the engine CLI.** *Why:* the engine stays a pure,
>   non-interactive detect→plan→apply core; interactive guardrails belong to the
>   skill that drives it.

## Problem

Standing up a quality harness — static-analysis evidence, lint guardrails, size
and complexity ratchets, coverage floors, CI feedback loops — and the
documentation/requirements scaffolding that makes a project legible to coding
agents is high-effort, easy to get subtly wrong, and rarely repeatable. This
repo has a battle-tested version of that harness (fallow metric ratchet, ESLint
severity-staging policy, LOC guard, perf/coverage gates, a documented doc
taxonomy), but it is entangled with Claudian-specifics and lives as hand-built
config, not a reusable, portable artifact.

We want a single Claude Code skill that bootstraps the whole thing — for new
projects **and** for older projects retroactively adopting agent-driven
development — deterministically, via bundled Node scripts, local-first, with
GitHub integration strictly opt-in.

## Goals

- One **self-contained, portable** skill: reuse = copy a single folder. No
  dependency on this repo's other skills, `CONTEXT.md` convention, or
  `check-*.mjs` scripts.
- **Deterministic and repeatable**: identical answers + identical starting
  state ⇒ identical result. All filesystem mutation flows through a bundled Node
  engine, never the agent's freehand edits.
- **Greenfield and brownfield**: safe to run on an existing repo with existing
  debt. Baselines initialize to the *current* state so the project never fails
  on day one — it snapshots today's debt and ratchets down.
- **Full harness, each guardrail toggleable**, with a **Jest-or-Vitest** choice.
- **Docs/requirements scaffolding** plus an optional interactive "grill"
  interview to seed real requirements.
- A standalone **quality report** the user can act on (advisory, not a gate).
- **Local-first**: works with no GitHub. GitHub tooling is added only when the
  user opts in.

## Non-goals

- Language-agnostic *tooling*. The harness is JS/TS (fallow, ESLint, Jest/Vitest
  are JS/TS tools). The *docs* scaffold is language-agnostic.
- A general project generator / framework scaffolder (no app boilerplate, no
  framework choices). This is a quality + docs harness only.
- Setting GitHub branch protection automatically (no API assumption); the skill
  prints guidance instead.
- Replacing this repo's existing superpowers flow. The skill bundles its own
  portable grill protocol rather than calling `brainstorming`/`grill-me-with-docs`.

## Users and use cases

1. **New JS/TS project** — run once, get docs + harness + (opt-in) CI in one
   pass, all gates green from an empty baseline.
2. **Old project adopting agent-driven development** — run once; baselines
   snapshot current debt, nothing blocks, the team ratchets down over time. The
   quality report shows them what they're adopting before they commit.
3. **Re-run / partial adoption** — idempotent re-runs to add a guardrail later,
   or converge after manual drift.

## Architecture — Approach A (thin skill, fat deterministic engine)

The agent (SKILL.md) **orchestrates and interviews**; a bundled Node CLI
(`setup.mjs`, "the engine") **owns every mutation**. The agent's job is: detect
state → run the interview → assemble an options object → invoke the engine →
report results. It never hand-writes harness files. The only intentionally
non-deterministic step is the grill interview.

Rejected alternatives: **B** (fat SKILL.md + helpers) — outcomes vary with agent
choices, not genuinely repeatable, hard to test. **C** (declarative manifest +
generic applier) — more abstraction than needed today (YAGNI); the engine's
options-object is a stepping stone toward C if ever wanted.

### Skill anatomy

The engine uses **only Node built-ins** (`node:fs`, `node:path`,
`node:child_process`, `node:test`) so the skill carries zero runtime
dependencies of its own; the tool dependencies it *installs* live in the
templates and land in the target project.

```
.claude/skills/project-setup/
  SKILL.md                     # orchestration: detect → interview → invoke engine → verify/report
  references/
    quality-harness.md         # what each guardrail is; ratchet + severity-staging mechanics
    docs-taxonomy.md           # doc folder taxonomy + frontmatter conventions
    grill.md                   # portable requirements-interview protocol
    github-integration.md      # opt-in CI / MCP / branch-protection guidance
  scripts/
    setup.mjs                  # engine CLI: detect | plan | apply | report | verify
    lib/
      detect.mjs               # read current project state → state object
      plan.mjs                 # options + state → ordered Action[] (pure)
      apply.mjs                # execute Action[] idempotently (write/merge/backup)
      merge.mjs                # JSON/text merge (package.json, tsconfig, eslint, .gitignore)
      baseline.mjs             # initialize ratchet baselines from current state
      templates.mjs            # load/render bundled templates
    templates/
      eslint.config.mjs.tmpl
      fallowrc.json.tmpl
      check-loc.mjs            # copied verbatim into target scripts/
      check-quality.mjs        # copied verbatim into target scripts/
      quality-report.mjs       # copied verbatim into target scripts/ (the user-facing report)
      ci.yml.tmpl             # github only
      jest/ …  vitest/ …       # framework-specific config + coverage wiring
      docs/ …                  # CONTEXT.md, adr/0000-template, specs/plans seeds,
                               # CONTRIBUTING + AGENTS "Quality evidence" sections,
                               # quality-integration-guide.md (rendered from options)
    tests/                     # node:test specs for the engine
```

The templates are **generalized** from this repo's `eslint.config.mjs`,
`.fallowrc.json`, `scripts/check-loc.mjs`, `scripts/check-quality.mjs`,
`.github/workflows/ci.yml`, and `docs/build-ci/quality-*.md`, stripped of
Claudian-specifics (provider-boundary zones, `obsidianmd/*` rules, Notice-i18n).

## Determinism and safety model

- **detect → plan → apply.** `plan` (≡ `apply --dry-run`) prints the ordered
  action list and mutates nothing. `apply` executes it.
- **Idempotent.** Re-running converges: each action checks whether it is already
  satisfied and skips if so. A second `apply` is a no-op.
- **Non-destructive.** Structured files (`package.json`, `tsconfig.json`,
  `.gitignore`, ESLint config) are **merged**, not replaced. Any genuine
  overwrite is **backed up** first (default `.project-setup-backup/<timestamp>/`).
  Conflicts the engine can't safely merge are **reported**, not silently
  resolved.
- **Explicit intent.** `apply`/`plan` require a `--config <answers.json>`; the
  engine refuses to mutate without one. A dirty git working tree triggers a
  warning (proceed with `--yes`).
- **Pinned versions.** The engine installs pinned tool versions (they ship in the
  generated `package.json`). `project-setup.report.json` records the resolved
  `options` only — not every action — so a re-apply stays a no-op (see the
  As-built note above).

### Engine CLI contract

```
node scripts/setup.mjs <command> [options]

  detect                 Print project-state JSON. No mutation.
  plan   --config <f>    Print the Action[] plan. No mutation. (= apply --dry-run)
  apply  --config <f>    Execute the plan idempotently. --dry-run to preview.
  report                 Write quality-report.md + .json. No mutation beyond the report.
  verify                 Run enabled gates once; summarize; non-zero exit on failure.

  --dry-run              Plan only; never mutate.
  --yes                  Non-interactive; assume confirmations.
  --backup-dir <dir>     Override backup location.
```

### Options object (`answers.json`)

```jsonc
{
  "packageManager": "npm",          // detected default (npm|pnpm|yarn|bun)
  "typescript": true,
  "testFramework": "jest",          // "jest" | "vitest"
  "guardrails": {
    "fallowRatchet": true,
    "locGuard": true,
    "eslintSeverityStaging": true,
    "coverageFloors": true,
    "ci": true
  },
  "github": { "integrate": false, "mcp": false, "fixApply": false },
  "docs": { "scaffold": true, "grill": false },
  "locCap": 500
}
```

## Phases (SKILL.md orchestration)

1. **Detect** — `setup.mjs detect`: package manager, TS, existing
   eslint/jest/vitest/fallow, git remote and whether it is GitHub, existing
   docs/`CONTEXT.md`. The agent uses this to tailor questions and skip redundant
   work.
2. **Interview** — guardrail toggles (default all on), **test framework (Jest or
   Vitest**, defaulting to whatever is detected), docs scaffold + optional grill,
   and the GitHub decision (see below). Answers → `answers.json`.
3. **Apply tooling** — `setup.mjs apply`: install deps via the detected package
   manager; merge configs (ESLint, fallow, tsconfig touch-ups); copy
   `check-loc.mjs`, `check-quality.mjs`, `quality-report.mjs`; add the
   `lint` / `check:loc` / `check:quality` / `test` / `test:coverage` / `quality:*`
   / `report` scripts; **initialize baselines** (see Brownfield).
4. **Scaffold docs** — create the taxonomy + seed files (idempotent/merge),
   including a `quality-integration-guide.md` rendered from the chosen options.
5. **Optional grill** — offer the interactive requirements interview; on accept,
   fill the `CONTEXT.md` glossary, seed ADRs, and a first requirements doc.
6. **GitHub (opt-in)** — only if chosen: add `.github/workflows/ci.yml` (jobs
   matched to enabled guardrails + chosen framework); optionally register the
   fallow MCP server (asking before enabling the write-capable `fix_apply`);
   print branch-protection guidance.
7. **Verify + report** — `setup.mjs verify` runs the enabled gates once and
   reports green/red; `setup.mjs report` emits the actionable quality report.
   Print a summary of everything created/changed and the next steps.

## Brownfield / retroactive adoption

The first-class mechanic for old projects: after configs and scripts are in
place, `baseline.mjs` **initializes every ratchet to the current state** so
nothing fails on adoption:

- **Fallow ratchet** — run `fallow --format json`, write `quality-baseline.json`
  from current metrics (dead code, dupes, complexity, maintainability floor).
- **LOC guard** — write `loc-baseline.json` grandfathering every current
  over-cap file at its present size (`reason: "grandfathered at adoption
  (YYYY-MM-DD)"`).
- **ESLint severity-staging** — generate the config with new/strict rules at
  `warn` (CI does not pass `--max-warnings`, so existing violations print but do
  not block); the current per-rule offender counts are captured in the report as
  the backlog to burn down.
- **Coverage floors** — if enabled, measure current coverage once and set the
  thresholds to the *current* values (rounded down), making coverage a rise-only
  floor that cannot drop. Day-one CI then passes even on a sparsely-tested repo,
  and the team ratchets the floor up over time (the same shape as the fallow
  maintainability floor). If coverage cannot be measured at adoption (e.g. the
  suite does not run yet), the coverage job is left **disabled** until the user
  sets thresholds, rather than shipping a gate that fails on day one.

The result: green CI on day one, with today's debt frozen as the bar. The team
ratchets down per PR, promoting `warn`→`error` as each backlog reaches zero —
the same policy this repo documents in `quality-gates.md`.

## Quality report (user-facing, advisory)

`quality-report.mjs` (copied into the target's `scripts/`, runnable as
`npm run report`) aggregates a single **actionable** snapshot — distinct from the
pass/fail `verify` gate:

- fallow health: score + letter grade, dead code, duplication, complexity
  hotspots, prioritized refactor targets;
- the ESLint `warn` backlog (counts per staged rule);
- LOC hotspots over the cap;
- coverage summary (if coverage floors enabled);
- a prioritized "act on this next" list.

Output: `quality-report.md` (to read) + `quality-report.json` (to act on, e.g.
by an agent). It can run **before** adoption too, to show a team exactly what
they are signing up for.

The report logic is **single-sourced** in `templates/quality-report.mjs` (the
portable artifact copied into the target so `npm run report` works without the
skill present); the engine's `setup.mjs report` command delegates to that same
implementation rather than duplicating it.

## Jest vs Vitest branch

- **Detect** an existing framework; default to it, else ask.
- **Jest** — `jest` + `ts-jest`, coverage via `jest --coverage` (Istanbul →
  `./coverage`), `eslint-plugin-jest` test rules, a CI coverage job.
- **Vitest** — `vitest` + `@vitest/coverage-istanbul` (chosen over v8 so
  fallow's CRAP can read `./coverage`), `eslint-plugin-vitest` test rules, a CI
  step.
- Both inherit the **"run the ratchet with `coverage/` absent"** caveat (a stray
  `coverage/` flips fallow from static-estimated to Istanbul CRAP and spikes
  critical-complexity findings); it is baked into the generated guide and the
  `check:quality` comment.

## Determinism boundaries (honest)

- **Deterministic / repeatable:** file scaffolding, config generation, dep and
  script wiring, baseline initialization (given the pinned tool versions).
- **Non-deterministic by nature:** the grill interview content; and tool
  *versions* if unpinned — so the engine pins what it installs and records it.

## Testing strategy

- **Engine unit tests** (`node:test`, zero-dep): `detect`/`plan`/`merge` as pure
  functions; `apply` against a temp dir; **idempotency** (apply twice → second
  run mutates nothing); **dry-run** (plan prints, mutates nothing);
  **non-destructive merge** (existing `package.json` keys preserved, backups
  written).
- **Subagent smoke test** (per `writing-skills`): run the skill end-to-end
  against a throwaway temp project (both a greenfield and a seeded-debt
  brownfield fixture) before declaring done.

## Portability

Copy `.claude/skills/project-setup/` into any repo with Node ≥20 (the engine
itself runs on ≥18, but the harness installs ESLint 9 / typescript-eslint 8,
which require ≥20). The engine has no runtime deps; templates carry the tool deps
that get installed into the target. Nothing references this repo.

## Post-ship polishing (review-driven, 2026-06-14)

After the initial ship, a four-perspective product review (first-run UX,
brownfield adoption, portability, safety/report) plus automated review drove a
second hardening pass. The themes, and **why** — all TDD'd, with the real
install→detect→apply loop now exercised (it was previously stubbed, which is why
several of these were invisible):

- **Idempotency across an install-induced detection flip.** A brownfield repo
  adopting TS installs `typescript`, flipping `detect()` true on the next run,
  which rewrote the run report and re-triggered baselining. The volatile fields
  (`typescript`/`testFramework`/`packageManager`) are now frozen from the first
  apply's report — the "second apply is a no-op" contract holds on that path.
- **The quality report was misleading and is now accurate + actionable.** It
  read a nonexistent `hotspots` key (so a CRAP-132 critical function reported as
  "Grade A / green"), fabricated "Grade F / 0%" on fresh repos, pointed at npm
  scripts that didn't exist, and used `npx` (network/yarn-PnP-fragile, and a
  failure became a false-green). It now reads fallow's real `findings`/`targets`,
  renders "n/a" for an unscored repo, generates the scripts it references, and
  resolves fallow locally with a fail-loud path.
- **Brownfield is green day-one and collisions are reported, not silent.** The
  ESLint template ships opinionated rules at `warn` (was `error` → day-one RED,
  contradicting this spec's severity-staging contract); a new `notice` action
  surfaces a kept `lint`/`test` script, a legacy `.eslintrc*`, an existing
  `ci.yml`, a skipped CI (GitHub-off / bun), and a hand-written test config whose
  coverage gate is stood down everywhere rather than wired to a RED.
- **Portability/onboarding polish.** Scaffolded docs render the detected package
  manager (not hardcoded `npm run`); the Node floor is stated as ≥20 (ESLint 9);
  Yarn CI uses `--frozen-lockfile` (valid on the default Yarn Classic); the
  dry-run preview is deduped and the install step is named; JS/JSX app
  entrypoints are detected; `setup.mjs report`/`verify` are documented.

The per-plan "As-built notes" cover the original ship; this section and the git
history are the record of the polishing pass.

## Risks and open questions

- **Package-manager breadth.** npm/pnpm/yarn/bun differ in install + script
  invocation. Start with npm + pnpm fully supported; yarn/bun detected with a
  graceful "manual install" fallback if needed.
- **ESLint flat vs legacy config.** Target flat config (ESLint ≥9); detect and
  warn on legacy `.eslintrc*` rather than silently dual-writing.
- **fallow availability offline.** Baseline init needs fallow installed first;
  the engine sequences install→baseline and degrades to "baseline pending — run
  `npm run check:quality -- --update`" if the install is blocked.
- **Monorepos.** v1 targets a single package root; detect a workspace and warn
  that per-package runs are needed (full monorepo support deferred).
