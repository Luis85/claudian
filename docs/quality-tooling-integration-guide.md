---
title: "Quality tooling integration guide (portable)"
date: 2026-06-14
status: active
scope: build-ci
---

# Quality tooling integration guide (portable)

A self-contained, **by-hand** recipe for adopting the same quality harness
Claudian runs — in **any** JS/TS project. It covers the whole suite, not just one
tool:

- a **fallow** metric ratchet (dead code, duplication, complexity),
- **ESLint** with a two-tier severity-staging policy,
- a per-file **LOC guard**,
- **coverage floors** (Jest or Vitest),
- **CI** (GitHub Actions), and
- an advisory **quality report**,

plus the **docs / requirements** scaffolding and the working conventions that
make the gates a process rather than a pile of configs.

> **Who this is for.** Anyone retrofitting agent-grade quality gates onto a
> greenfield or brownfield repo and wiring them by hand. Every config and script
> below is complete and copy-pasteable — no generator, no plugin, no external
> skill required. Copy what you need, skip what you don't; each gate is
> independent.

## How this differs from the other two build-ci docs

| Document | What it is |
|----------|------------|
| **This guide** | **Portable.** How to stand the suite up from scratch in your own project, by hand. |
| [`build-ci/quality-integration-guide.md`](build-ci/quality-integration-guide.md) | How the harness is wired **in Claudian specifically** (its paths, its divergences). |
| [`build-ci/quality-gates.md`](build-ci/quality-gates.md) | Claudian's authoritative **gate catalogue**, ratchet mechanics, and campaign history. |

When this guide and the Claudian-specific ones disagree on a value (a path, a
cap, a version), they're describing two different repos — trust this one for
**your** project and adapt freely.

---

## The suite at a glance

Every gate follows one shape: a **blocking** command that fails CI, and
**advisory** commands that only print signal. Most gates are a **ratchet** —
they snapshot today's state as a baseline and then only allow improvement.

| Gate | Owns | Blocking command | Advisory |
|------|------|------------------|----------|
| **ESLint** | correctness, security, import hygiene, function health | `npm run lint` (**error**-tier only) | `warn`-tier rules (print, never fail) |
| **LOC guard** | per-file size ratchet | `npm run check:loc` | `-- --update` to re-lock |
| **fallow ratchet** | dead code, clones, complexity, maintainability | `npm run check:quality` (whole-repo metric ratchet) | `npm run quality`, `quality:audit`, `quality:dead-code`, `quality:dupes` |
| **Coverage floors** | statements/branches/functions/lines | `npm run test:coverage` | — |
| **Quality report** | a prioritized "do this next" list | _(none — advisory only)_ | `npm run report` |

The whole local set, before pushing (the same set CI runs):

```bash
npm run lint && npm run check:loc && npm run check:quality && npm run test:coverage
```

> **Read this before your first `check:quality` run.** Run the fallow ratchet
> with **no `coverage/` directory present**. A stray `coverage/` flips fallow's
> complexity weighting from static estimation to Istanbul-weighted CRAP, which
> spikes the critical-complexity count and breaks the gate against a baseline
> measured without it. Always run `npm run test:coverage` **last**. This single
> caveat causes more confusion than the rest of the suite combined.

---

## Two ideas that run through everything

Before the per-tool setup, two mental models. Internalize these and the rest is
mechanical.

### 1. The ratchet (baseline-from-current-state)

A ratchet **freezes today's debt and only lets it shrink.** You don't have to
fix anything to adopt a gate — you snapshot the current numbers as a baseline,
commit it, and from then on CI fails only on **regression** past that line.

- **Counters are shrink-only** (dead-code issues, clone groups, oversized files,
  complex functions). They may fall freely; they may not grow past baseline.
- **Floors are rise-only** (coverage %, maintainability score). They may climb
  freely; they may not drop below baseline.
- **Lock improvements in the same PR.** When a number gets better, re-run the
  gate's `--update` and commit the new baseline, so the gain can't silently
  regress later. The gates print a reminder when you have an unlocked gain.
- **A regression that's actually a deliberate trade-off** bumps the baseline the
  same way — `--update`, commit the diff, and justify it in the PR.

This is why the harness adopts cleanly onto a messy brownfield repo: nothing is
red on day one, and the codebase can only get better from wherever it is.

### 2. Severity-staging (stage → burn → promote → record)

ESLint uses the same "only improve" spirit for rules. Every opinionated rule
starts at **`warn`** (a tracked backlog that prints but does not fail CI) and is
promoted to **`error`** (blocks CI) only once its backlog reaches zero.

1. **Stage** the rule at `warn`.
2. **Burn** the backlog down — decompose offenders; never blanket-disable.
3. **Promote** the rule to `error` to lock the gain.
4. **Record** the promotion (a CHANGELOG line, a note in your contributing doc)
   so the history stays legible.

CI deliberately does **not** pass `--max-warnings`, so a noisy new rule can land
without blocking unrelated work. The configs below ship **every** preset rule
staged to `warn` — so day-one CI is green on any repo — and you promote at your
own pace.

---

## Prerequisites

- **Node 18+** (CI below pins **22**). All scripts are zero-dependency ESM
  (`.mjs`) and use only `node:` builtins.
- A `package.json` with a `scripts` block.
- **npm** is assumed throughout. For pnpm/yarn/bun, substitute the run prefix
  (`pnpm`, `yarn`, `bun run`) and see [CI](#5-ci-github-actions) for the
  install/cache deltas.

Pin versions deliberately. The set below is **known-good together** (bump as a
reviewed change, verifying each with `npm view <pkg> version`):

| Package | Version |
|---------|---------|
| `eslint`, `@eslint/js` | `9.36.0` |
| `typescript-eslint` | `8.45.0` |
| `eslint-plugin-simple-import-sort` | `12.1.1` |
| `eslint-plugin-jest` | `28.14.0` |
| `eslint-plugin-vitest` | `0.5.4` |
| `fallow` | `2.91.0` |
| `jest`, `ts-jest`, `@types/jest` | `30.3.0`, `29.4.9`, `30.0.0` |
| `vitest`, `@vitest/coverage-istanbul` | `2.1.9` |
| `typescript` | `5.9.3` |

---

## 1. ESLint (severity-staging)

**Install** (TypeScript + Jest shown; see the deltas after):

```bash
npm i -D eslint@9.36.0 @eslint/js@9.36.0 typescript-eslint@8.45.0 \
  eslint-plugin-simple-import-sort@12.1.1 eslint-plugin-jest@28.14.0
```

- **JavaScript-only repo:** drop `typescript-eslint` (and remove the TS pieces
  marked below).
- **Vitest instead of Jest:** swap `eslint-plugin-jest` for
  `eslint-plugin-vitest@0.5.4`.

**`eslint.config.mjs`** (flat config, repo root). The `stage()` helper rewrites
every preset rule from `error` to `warn` on load — that's the whole
severity-staging mechanism:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';            // omit for JS-only
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import jestPlugin from 'eslint-plugin-jest';          // or eslint-plugin-vitest

// Two-tier severity policy: `error` blocks CI, `warn` stages a backlog (CI does
// NOT pass --max-warnings). Every rule from the shared presets is staged to
// `warn`; promote a rule back to `error` once its backlog reaches zero.
const staged = (rules) =>
  Object.fromEntries(
    Object.entries(rules ?? {}).map(([name, value]) => {
      const severity = Array.isArray(value) ? value[0] : value;
      const isError = severity === 'error' || severity === 2;
      if (!isError) return [name, value];
      return [name, Array.isArray(value) ? ['warn', ...value.slice(1)] : 'warn'];
    }),
  );
const stage = (config) => ({ ...config, rules: staged(config.rules) });

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs', 'scripts/check-loc.mjs', 'scripts/check-quality.mjs', 'scripts/quality-report.mjs'] },
  stage(js.configs.recommended),
  ...tseslint.configs.recommended.map(stage),         // omit for JS-only
  {
    files: ['**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'],
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      // Off: without env/globals detection it false-fails on standard
      // Node/browser globals in JS sources (TS uses the compiler instead).
      'no-undef': 'off',
      'no-console': 'warn',
      'no-unused-vars': 'warn',
      // TS-only — drop these three on a JS repo:
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
      complexity: ['warn', { max: 25 }],
      'max-lines-per-function': ['warn', { max: 200, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', { max: 6 }],
      'max-depth': ['warn', { max: 5 }],
    },
  },
  // Test-runner rules. For Vitest, this block needs the runner's globals — see note below.
  { files: ['**/*.{test,spec}.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'], ...stage(jestPlugin.configs['flat/recommended']) },
];
```

> **Vitest test block.** With Vitest globals enabled, the recommended rules alone
> leave `describe`/`it`/`expect` undefined. Replace the last block with:
> ```js
> import vitestPlugin from 'eslint-plugin-vitest';
> // ...
> {
>   files: ['**/*.{test,spec}.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'],
>   languageOptions: { globals: { suite: 'readonly', test: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', vi: 'readonly', expectTypeOf: 'readonly', assertType: 'readonly' } },
>   plugins: { vitest: vitestPlugin },
>   rules: staged(vitestPlugin.configs.recommended.rules),
> },
> ```

**`package.json` scripts:**

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
```

**How it gates.** `npm run lint` exits non-zero only on `error`-tier rules, so
CI is green while your backlog sits at `warn`. To tighten: flip a rule to
`error` once `npm run lint` shows zero of it, and record the promotion.

**Suppressions.** Use a **narrow** `// eslint-disable-next-line <rule>` with a
justification comment — never a blanket file/rule disable. Track intentional
suppressions as tech debt so they get revisited, not accumulated.

---

## 2. LOC guard (per-file size ratchet)

Zero dependencies. Catches files growing without bound — signal the
function-level `max-lines-per-function` rule can't see.

**`scripts/check-loc.mjs`** (cap **500**; the `SRC` root should be your source
dir, or `.` for a repo-root layout):

```js
#!/usr/bin/env node
/* Ratchets per-file nonblank LOC vs scripts/loc-baseline.json.
 * Files <= MAX_LOC are fine; grandfathered hotspots may shrink but not grow.
 * `--update` rewrites the baseline from the current state (use at adoption). */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const BASELINE = join(ROOT, 'scripts', 'loc-baseline.json');
const MAX_LOC = 500;
const SRC = join(ROOT, 'src'); // source root — set to '.' for a repo-root layout
const EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.fallow']);
const update = process.argv.includes('--update');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (EXT.test(name)) out.push(abs);
  }
  return out;
}
const loc = (abs) => readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
const toPosix = (p) => p.split(sep).join('/');

const current = {};
for (const abs of walk(SRC)) {
  const n = loc(abs);
  if (n > MAX_LOC) current[toPosix(relative(ROOT, abs))] = n;
}

if (update) {
  writeFileSync(BASELINE, JSON.stringify({ maxLoc: MAX_LOC, files: current }, null, 2) + '\n');
  console.log(`Updated ${toPosix(relative(ROOT, BASELINE))} (${Object.keys(current).length} grandfathered).`);
  process.exit(0);
}
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { files: {} };
const fails = [];
for (const [file, n] of Object.entries(current)) {
  const base = baseline.files[file];
  if (base === undefined) fails.push(`  ${file}: ${n} > ${MAX_LOC} (new oversized file)`);
  else if (n > base) fails.push(`  ${file}: ${n} (baseline ${base})`);
}
if (fails.length) {
  console.error('LOC guard FAILED:\n' + fails.join('\n') + '\n\nSplit the file, or run `node scripts/check-loc.mjs --update` for a reviewed bump.');
  process.exit(1);
}
console.log('LOC guard OK.');
```

**`package.json` script:** `"check:loc": "node scripts/check-loc.mjs"`.

**Baseline (once, at adoption):**

```bash
node scripts/check-loc.mjs --update   # writes scripts/loc-baseline.json
git add scripts/loc-baseline.json
```

**How it gates.** A *new* file over the cap fails. A grandfathered file may
shrink but not grow past its own recorded line. Shrink one below the cap and it
drops off the allowlist on the next `--update` — locking the win.

---

## 3. fallow ratchet (dead code, clones, complexity)

[fallow](https://github.com/fallow-rs/fallow) is the deterministic evidence
layer. We gate on a **whole-repo metric ratchet** rather than fallow's own gate
flags (`--fail-on-regression`, `--min-score`), which did not reliably drive the
process exit code as of 2.91 — the JSON report is stable, so the wrapper parses
that.

**Install:** `npm i -D fallow@2.91.0`.

**`.fallowrc.json`** (repo root). Set `entry` to your real source entry — without
it, fallow can't find the import-graph root and reads the whole tree as unused:

```json
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  "entry": ["src/index.ts"],
  "ignorePatterns": ["**/docs/**", "**/coverage/**", "**/dist/**", "**/.fallow/**", "**/tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/scripts/check-quality.mjs", "**/scripts/check-loc.mjs", "**/scripts/quality-report.mjs"],
  "duplicates": { "minOccurrences": 2, "ignore": ["**/tests/**", "**/*.test.*"] },
  "rules": { "unused-dependencies": "warn" }
}
```

> `unused-dependencies: warn` softens **fallow's own** verdict only. The ratchet
> below still counts a new unused dep under `deadCodeIssues` (pinned at 0), so it
> **does** fail the gate — remove the dep, or add a genuinely-provided one (a
> runtime/peer dep fallow can't see) to an `ignoreDependencies` array.

**`scripts/check-quality.mjs`** — the blocking ratchet. Reads fallow's combined
JSON and enforces shrink-only counters / rise-only floors against
`scripts/quality-baseline.json`:

```js
#!/usr/bin/env node
/**
 * Quality ratchet: fail when a fallow codebase metric regresses past the
 * committed baseline (scripts/quality-baseline.json).
 *
 * Policy (a ratchet, not a freeze):
 *   - Counter metrics may shrink freely but may NOT grow past baseline.
 *   - Floor metrics (average maintainability) may rise but NOT drop.
 *   - Lock a gain in the same PR: `node scripts/check-quality.mjs --update`.
 *
 * Usage:
 *   node scripts/check-quality.mjs            # verify (CI + local)
 *   node scripts/check-quality.mjs --update   # rewrite the baseline
 *   node scripts/check-quality.mjs --json     # machine-readable failure report
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASELINE_PATH = join(__dirname, 'quality-baseline.json');
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const update = args.includes('--update');
const asJson = args.includes('--json');

// direction 'max': counter that may only shrink. 'min': floor that may only rise.
const METRICS = {
  deadCodeIssues: { direction: 'max', read: (r) => r.check.summary.total_issues, label: 'dead-code issues (fallow dead-code)' },
  circularDependencies: { direction: 'max', read: (r) => r.check.summary.circular_dependencies, label: 'circular dependencies (fallow dead-code)' },
  cloneGroups: { direction: 'max', read: (r) => r.dupes.stats.clone_groups, label: 'clone groups (fallow dupes)' },
  duplicatedLines: { direction: 'max', read: (r) => r.dupes.stats.duplicated_lines, label: 'duplicated lines (fallow dupes)' },
  complexFunctions: { direction: 'max', read: (r) => r.health.summary.functions_above_threshold, label: 'functions above complexity threshold (fallow health)' },
  criticalComplexity: { direction: 'max', read: (r) => r.health.summary.severity_critical_count, label: 'critical-severity complexity findings (fallow health)' },
  averageMaintainability: { direction: 'min', read: (r) => r.health.summary.average_maintainability, label: 'average maintainability score (fallow health)', epsilon: 0.05 },
};

const toPosix = (path) => path.split(sep).join('/');

function runFallow() {
  const bin = require.resolve('fallow/bin/fallow');
  const stdout = execFileSync(process.execPath, [bin, '--quiet', '--format', 'json'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'], // fallow exits non-zero on findings; report is still complete
  });
  return JSON.parse(stdout);
}

let report;
try {
  report = runFallow();
} catch (err) {
  if (err.stdout) { try { report = JSON.parse(err.stdout); } catch { report = null; } }
  if (!report) {
    console.error('Quality ratchet ERROR: fallow did not produce a JSON report.');
    console.error(String(err.message ?? err));
    process.exit(2);
  }
}

const current = {};
for (const [name, metric] of Object.entries(METRICS)) {
  const value = metric.read(report);
  if (typeof value !== 'number' || Number.isNaN(value)) {
    console.error(`Quality ratchet ERROR: could not read "${name}" from the fallow report (schema changed?).`);
    process.exit(2);
  }
  current[name] = value;
}

if (update) {
  const next = {
    description: 'Fallow quality baseline. Counters may shrink but not grow; averageMaintainability may rise but not drop. Regenerate with `node scripts/check-quality.mjs --update` (commit the diff in the same PR that moves the metric).',
    fallowVersion: report.version ?? 'unknown',
    metrics: current,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log(`Updated ${toPosix(relative(ROOT, BASELINE_PATH))}: ` + Object.entries(current).map(([k, v]) => `${k}=${v}`).join(', '));
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error('Quality ratchet ERROR: missing or unreadable scripts/quality-baseline.json. Generate it with `node scripts/check-quality.mjs --update`.');
  process.exit(2);
}

const regressions = [];
const improvements = [];
for (const [name, metric] of Object.entries(METRICS)) {
  const base = baseline.metrics?.[name];
  if (typeof base !== 'number') {
    regressions.push({ name, message: `  ${name}: missing from baseline — run \`node scripts/check-quality.mjs --update\`` });
    continue;
  }
  const value = current[name];
  const epsilon = metric.epsilon ?? 0;
  if (metric.direction === 'max') {
    if (value > base) regressions.push({ name, message: `  ${name}: ${value} (baseline ${base}) — ${metric.label}` });
    else if (value < base) improvements.push(`  ${name}: ${value} (baseline ${base})`);
  } else {
    if (value < base - epsilon) regressions.push({ name, message: `  ${name}: ${value} (baseline floor ${base}) — ${metric.label}` });
    else if (value > base + epsilon) improvements.push(`  ${name}: ${value} (baseline ${base})`);
  }
}

if (regressions.length > 0) {
  if (asJson) {
    console.error(JSON.stringify({ regressions, current, baseline: baseline.metrics }, null, 2));
  } else {
    console.error('Quality ratchet FAILED — metric(s) regressed past the baseline:');
    for (const r of regressions) console.error(r.message);
    console.error('\nFix the regression (run `npm run quality` for details), or — only for a deliberate, reviewed trade-off — bump the baseline with `node scripts/check-quality.mjs --update` and justify it in the PR.');
  }
  process.exit(1);
}

console.log(`Quality ratchet OK: ${Object.entries(current).map(([k, v]) => `${k}=${v}`).join(', ')}.`);
if (improvements.length > 0) {
  console.log('Improvement(s) not yet locked in — run `node scripts/check-quality.mjs --update` and commit the baseline so the gain cannot regress:');
  for (const line of improvements) console.log(line);
}
process.exit(0);
```

**`package.json` scripts:**

```json
{
  "scripts": {
    "quality": "fallow",
    "quality:audit": "fallow audit",
    "quality:dead-code": "fallow dead-code",
    "quality:dupes": "fallow dupes",
    "check:quality": "node scripts/check-quality.mjs"
  }
}
```

**Baseline (once, at adoption — with `coverage/` absent):**

```bash
rm -rf coverage
node scripts/check-quality.mjs --update   # writes scripts/quality-baseline.json
git add scripts/quality-baseline.json
```

**How it gates.** `npm run check:quality` fails if any counter grew or any floor
dropped. `npm run quality` / `quality:health` are for reading detail;
`quality:audit` is an advisory changed-files review (run it before opening a
PR). Treat the structural counters (`circularDependencies`) as **architecture
decisions** — the ratchet *allows* a bump, but any increase deserves an ADR, not
a quiet baseline edit.

---

## 4. Coverage floors (Jest or Vitest)

Coverage thresholds are stored **in the test runner's config** as a rise-only
floor: today's coverage becomes the minimum, and CI fails if it drops. Use the
**istanbul** provider so the same `coverage/` artifact is readable by tools that
want it — and remember to delete it before the fallow ratchet runs (caveat
above).

### Jest

**Install** (TS): `npm i -D jest@30.3.0 ts-jest@29.4.9 @types/jest@30.0.0 typescript@5.9.3`
(JS: just `npm i -D jest@30.3.0`).

**`jest.config.mjs`:**

```js
export default {
  preset: 'ts-jest',                 // omit on a JS-only repo
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', '!**/*.{test,spec}.*', '!**/dist/**', '!**/scripts/check-loc.mjs', '!**/scripts/check-quality.mjs', '!**/scripts/quality-report.mjs'],
  // json-summary writes coverage/coverage-summary.json — the file the baseline
  // step and the quality report read.
  coverageReporters: ['json-summary', 'text'],
  // Filled by the baseline step below; default 0 is a rise-only no-op floor.
  coverageThreshold: { global: { statements: 0, branches: 0, functions: 0, lines: 0 } },
};
```

### Vitest

**Install:** `npm i -D vitest@2.1.9 @vitest/coverage-istanbul@2.1.9`.

**`vitest.config.mjs`:**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',                 // istanbul so ./coverage is portable
      reporter: ['json-summary', 'text'],   // writes coverage/coverage-summary.json
      include: ['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
      exclude: ['**/*.{test,spec}.*', '**/dist/**', '**/scripts/check-loc.mjs', '**/scripts/check-quality.mjs', '**/scripts/quality-report.mjs'],
      thresholds: { statements: 0, branches: 0, functions: 0, lines: 0 },
    },
  },
});
```

**`package.json` scripts** (Jest shown; Vitest uses `vitest run` /
`vitest run --coverage`):

```json
{
  "scripts": {
    "test": "jest --passWithNoTests",
    "test:coverage": "jest --coverage --passWithNoTests"
  }
}
```

**Baseline (once, at adoption):** run coverage, then set each threshold to the
floored current percentage from `coverage/coverage-summary.json`:

```bash
npm run test:coverage
node -e "const s=require('./coverage/coverage-summary.json').total;for(const k of['statements','branches','functions','lines'])console.log(k, Math.floor(s[k].pct))"
```

Copy those four numbers into `coverageThreshold` (Jest) / `thresholds` (Vitest),
then commit. From then on the runner fails if coverage drops below the floor.
**Floor, don't ceiling** — set the threshold to the floored current value so
normal churn doesn't trip it, and raise it deliberately as coverage climbs.

---

## 5. CI (GitHub Actions)

One workflow runs the same gates on every PR and on pushes to your trunk. The
ordering matters: **`test:coverage` runs last**, so the fallow ratchet sees no
`coverage/` directory.

**`.github/workflows/ci.yml`** (npm; `main` is the default branch):

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run check:loc
      - run: npm run check:quality   # runs with ./coverage absent
      - run: npm run test:coverage
```

Include only the steps for gates you actually installed. The `pull_request:`
trigger is unfiltered (every PR runs), while `push:` is scoped to your trunk.

> **Commit your lockfile.** `npm ci` + the dependency cache both require a
> committed lockfile. A fresh install creates one but doesn't commit it — commit
> `package-lock.json` (or your manager's lockfile) alongside the generated
> files, or day-one CI fails before any gate runs.

**Other package managers** — change three things (install, cache, and the
`npm run` prefix on each step):

| Manager | Extra setup step | `cache:` | Install | Run prefix |
|---------|------------------|----------|---------|------------|
| **npm** | — | `npm` | `npm ci` | `npm run` |
| **pnpm** | `- uses: pnpm/action-setup@v4`<br>`  with: { version: 9 }` (before setup-node) | `pnpm` | `pnpm install --frozen-lockfile` | `pnpm` |
| **yarn** | — | `yarn` | `yarn install --frozen-lockfile` | `yarn` |

(`--frozen-lockfile`, not Berry's `--immutable`: `setup-node` defaults to Yarn
Classic, which errors on `--immutable`; Berry accepts `--frozen-lockfile` too.)

---

## 6. Quality report (advisory)

A non-blocking "what to fix next" snapshot — health grade, dead-code and clone
counts, coverage, and a prioritized action list. Never gates; run it before
requesting review. It reuses the already-installed fallow, so there's no extra
dependency.

Drop the script at **`scripts/quality-report.mjs`** and wire
`"report": "node scripts/quality-report.mjs"`. The full reference implementation
is in [Appendix A](#appendix-a-quality-reportmjs). It writes `quality-report.md`
(human) and `quality-report.json` (machine), detects your package manager so the
action commands it prints are correct, and never fabricates a "Grade F / 0%" on
a fresh repo with nothing to score yet.

```bash
npm run report   # -> quality-report.md + quality-report.json
```

---

## Docs & requirements scaffolding

The harness gates *code*; these conventions gate *intent and decisions*. Scaffold
them once and keep them current.

| Path | Purpose |
|------|---------|
| `CONTEXT.md` | **Project glossary** — canonical terms, definitions, and an avoid-list of synonyms that must not appear in code or docs. Pure glossary: no specs, no implementation. |
| `docs/adr/0000-template.md` | **ADR template.** Copy + renumber per architectural decision. |
| `CONTRIBUTING.md` | A short **quality-evidence checklist** for contributors (below). |

**`CONTEXT.md`:**

```markdown
# CONTEXT

Project glossary — canonical terms, definitions, and an avoid-list. Keep this a
pure glossary: no implementation details, no specs.

## Terms

<!-- term: definition -->
```

**`docs/adr/0000-template.md`:**

```markdown
---
title: "ADR-NNNN: <decision>"
date: <YYYY-MM-DD>
status: proposed
---

## Context

## Decision

## Consequences
```

**`CONTRIBUTING.md`** — point contributors at the one local command that mirrors
CI:

```markdown
## Quality evidence

Run before requesting review (the same gates CI runs):

    npm run lint && npm run check:loc && npm run check:quality && npm run test:coverage
    npm run report   # advisory: quality-report.md to act on
```

**Folder & frontmatter conventions.** Durable docs (ADRs, specs, plans,
research, reviews, handoffs) carry YAML frontmatter (`title`, `date`, `status`,
`scope`) and live under predictable folders — `docs/adr/`, `docs/specs/`,
`docs/plans/`, `docs/research/`, `docs/reviews/`, `docs/handoffs/`. One ADR per
decision, numbered sequentially. Keep the glossary the single source of domain
terms; update it whenever a new term appears, and challenge any term that's
ambiguous or overloaded.

---

## The everyday workflow

1. **Write code and tests.**
2. **Run the full local set** (identical to CI):
   ```bash
   npm run lint && npm run check:loc && npm run check:quality && npm run test:coverage
   ```
   Remember `check:quality` wants `coverage/` absent — run `test:coverage`
   **last** (it's last in the command above).
3. **Read the advisory signal:** `npm run report`, and `npm run quality:audit`
   for a changed-files verdict before opening the PR.
4. **Lock any improvements** you made — for each gate that says "improvement not
   locked in", run its `--update` and commit the baseline diff **in the same
   PR**:
   ```bash
   node scripts/check-quality.mjs --update
   node scripts/check-loc.mjs --update
   ```
5. **Open the PR.** CI re-runs the same gates.

---

## Guidelines (the conventions that make it stick)

- **Adopt by baselining, not by fixing.** Snapshot current state, commit the
  baseline, improve over time. Never block day-one CI on pre-existing debt.
- **Lock every gain in the same PR.** An unlocked improvement can silently
  regress later. `--update` + commit is the lock.
- **A baseline bump is a reviewed decision.** Whether it's a deliberate
  trade-off or a structural change, justify it in the PR — never quietly widen a
  ratchet to make CI pass.
- **Promote lint rules deliberately.** Stage at `warn`, burn to zero, promote to
  `error`, record it. Don't leave a rule at `warn` forever "just in case."
- **Suppress narrowly, with a reason.** `// eslint-disable-next-line <rule>` /
  fallow's `fallow-ignore-next-line <rule>` — one line, one justification, and a
  plan to remove it. Never a blanket disable.
- **Keep the fallow ratchet honest about coverage.** Always run it with
  `coverage/` absent; run `test:coverage` last; `coverage/` and `.fallow/`
  belong in `.gitignore`.
- **Commit the baselines and the lockfile.** `scripts/loc-baseline.json`,
  `scripts/quality-baseline.json`, the coverage thresholds (in the runner
  config), and your package-manager lockfile are all part of the gate.

### `.gitignore`

```gitignore
node_modules/
dist/
coverage/
.fallow/
quality-report.md
quality-report.json
```

---

## Notes for coding agents

Agents should treat the same gates as the human workflow, plus fallow's
machine-readable surfaces:

- **Run the gate, not just the sweep.** `npm run check:quality` is the bar;
  `npm run quality` / `quality:health` are for reading detail. Run
  `npm run quality:audit` before requesting review.
- **Use JSON for programmatic reads:** `fallow <cmd> --format json --quiet`.
  Findings carry an `actions` array with `auto_fixable` flags — check those
  before hand-fixing. `node scripts/check-quality.mjs --json` prints a
  machine-readable failure report.
- **Don't "fix" the intentional bits:** the `coverage/`-absent caveat, lint
  `warn`s not failing CI (promotion is what enforces a rule), and
  `unused-dependencies` being `warn` while still counting toward the gate. None
  are bugs.

---

## Adoption checklist

```text
[ ] Pin and install the tool deps you want (ESLint / fallow / runner).
[ ] Add eslint.config.mjs + lint, lint:fix scripts.
[ ] Add scripts/check-loc.mjs + check:loc; run --update; commit the baseline.
[ ] Add .fallowrc.json (correct `entry`) + scripts/check-quality.mjs + scripts;
    run --update with coverage/ ABSENT; commit the baseline.
[ ] Add the runner config (coverage istanbul + json-summary) + test, test:coverage;
    run coverage; set the floors from coverage-summary.json; commit.
[ ] Add scripts/quality-report.mjs + report (optional, advisory).
[ ] Add .github/workflows/ci.yml with one step per installed gate (test:coverage LAST).
[ ] Scaffold CONTEXT.md, docs/adr/0000-template.md, CONTRIBUTING.md.
[ ] Update .gitignore (coverage/, .fallow/, report artifacts).
[ ] Commit the lockfile so CI's strict install works.
[ ] Verify: npm run lint && npm run check:loc && npm run check:quality && npm run test:coverage
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `criticalComplexity` jumped 0 → ~24 | A `coverage/` directory is present during `check:quality`. Remove it; run `test:coverage` last. |
| Ratchet failed but I didn't add debt | Check for a stray `coverage/` first. Otherwise a metric genuinely grew — run `npm run quality` for detail; lock real improvements with `--update`. |
| fallow reports the whole tree as "unused" | `entry` in `.fallowrc.json` doesn't point at your real source entry. Set it (e.g. `["src/index.ts"]`). |
| "Unused dependency" failing the gate | The `warn` severity only softens fallow's own verdict; the ratchet still counts it. Remove the dep, or add a genuinely runtime/provided dep to `ignoreDependencies`. |
| A lint `warn` isn't failing CI | Expected — CI doesn't pass `--max-warnings`. Promote the rule to `error` to enforce it. |
| `coverageThreshold` trips on unrelated churn | You set a ceiling, not a floor. Lower each threshold to the floored **current** percentage; raise deliberately. |
| Day-one CI fails at install | Commit your lockfile — `npm ci` / `--frozen-lockfile` require it. |
| LOC guard fails on a brand-new big file | That's the gate working. Split the file, or `--update` for a reviewed grandfather entry. |

---

## Appendix A: `scripts/quality-report.mjs`

Advisory only — never a gate. Self-contained; depends only on the
already-installed fallow.

```js
#!/usr/bin/env node
/* Advisory quality report (NOT a gate). -> quality-report.md + quality-report.json */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

export function gradeFor(score) {
  const s = typeof score === 'number' ? score : 0;
  return s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F';
}

// Pure projection of fallow's JSON (fallow 2.91) into the report's data shape.
export function extractData({ healthJson = {}, deadJson = {}, dupesJson = {}, coverageSummary = null } = {}) {
  const hs = healthJson.health_score ?? {};
  const summary = healthJson.summary ?? {};
  const hasScore = typeof hs.score === 'number';
  const findings = Array.isArray(healthJson.findings) ? healthJson.findings : [];
  const hotspots = findings
    .filter((f) => f && (f.severity === 'critical' || f.severity === 'high'))
    .sort((a, b) => (b.crap ?? 0) - (a.crap ?? 0))
    .slice(0, 5)
    .map((f) => ({ name: f.name ?? '(anonymous)', file: f.path ?? f.file ?? '?', crap: f.crap ?? 0, severity: f.severity }));
  const targets = (Array.isArray(healthJson.targets) ? healthJson.targets : [])
    .filter((t) => t && typeof t.recommendation === 'string')
    .slice(0, 3);
  const pct = coverageSummary?.total?.lines?.pct;
  return {
    health: {
      score: hasScore ? hs.score : null,
      grade: hasScore ? (hs.grade ?? gradeFor(hs.score)) : null,
      criticalCount: summary.severity_critical_count ?? hotspots.filter((h) => h.severity === 'critical').length,
      hotspots,
    },
    deadCode: deadJson.summary ?? { total_issues: 0 },
    dupes: dupesJson.stats ?? { clone_groups: 0 },
    lintWarnings: { total: 0, byRule: {} },
    locHotspots: [],
    coverage: { lines: typeof pct === 'number' ? Math.floor(pct) : null },
    targets,
  };
}

export function buildReport(d, runCmd = 'npm run') {
  const actions = [];
  for (const h of d.health.hotspots ?? []) actions.push(`Refactor complexity hotspot ${h.name} (${h.file}, CRAP ${h.crap}).`);
  if (d.deadCode.total_issues > 0) actions.push(`Remove ${d.deadCode.total_issues} dead-code finding(s) (${runCmd} quality:dead-code).`);
  if (d.dupes.clone_groups > 0) actions.push(`Dedupe ${d.dupes.clone_groups} clone group(s) (${runCmd} quality:dupes).`);
  if (typeof d.coverage.lines === 'number' && d.coverage.lines < 80) actions.push(`Raise test coverage — currently ${d.coverage.lines}% lines (target 80%).`);
  for (const t of d.targets ?? []) actions.push(t.recommendation);
  for (const [rule, n] of Object.entries(d.lintWarnings.byRule)) actions.push(`Burn down ${n}x lint warn: ${rule} (then promote to error).`);
  for (const h of d.locHotspots) actions.push(`Split oversized file ${h.file} (${h.loc} LOC).`);

  const healthCell = d.health.score == null ? 'n/a (new project — nothing to score yet)' : `${d.health.score} (Grade ${d.health.grade})`;
  const coverageCell = d.coverage.lines == null ? 'no tests yet' : `${d.coverage.lines}% lines`;
  const lines = [
    '# Quality report', '',
    `**Health:** ${healthCell} | **Coverage:** ${coverageCell}`,
    `**Dead code:** ${d.deadCode.total_issues} | **Clone groups:** ${d.dupes.clone_groups} | **Lint warnings:** ${d.lintWarnings.total}`,
    '', '## Act on this next', '',
    actions.length ? actions.map((a, i) => `${i + 1}. ${a}`).join('\n') : '_No action items — the harness is green._',
    '',
  ];
  return { markdown: lines.join('\n'), json: { ...d, actions } };
}

function runFallow(sub) {
  let bin;
  try { bin = require.resolve('fallow/bin/fallow'); }
  catch { throw new Error('fallow is not installed — install deps, then `report` again.'); }
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [bin, ...sub, '--quiet', '--format', 'json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { stdout = e.stdout; } // non-zero on findings; the JSON report is on stdout
  if (!stdout || !stdout.trim()) throw new Error(`fallow ${sub.join(' ')} produced no output.`);
  try { return JSON.parse(stdout); } catch { throw new Error(`fallow ${sub.join(' ')} did not return JSON.`); }
}

export function detectRunCmd(cwd = process.cwd()) {
  let pm = 'npm';
  try {
    const declared = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).packageManager;
    if (typeof declared === 'string') pm = declared.split('@')[0];
  } catch { /* no field */ }
  if (pm === 'npm') {
    if (existsSync(join(cwd, 'pnpm-lock.yaml'))) pm = 'pnpm';
    else if (existsSync(join(cwd, 'yarn.lock'))) pm = 'yarn';
    else if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) pm = 'bun';
  }
  return pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bun run' : 'npm run';
}

function main(cwd = process.cwd()) {
  const runCmd = detectRunCmd(cwd);
  let healthJson, deadJson, dupesJson;
  try {
    healthJson = runFallow(['health']);
    deadJson = runFallow(['dead-code']);
    dupesJson = runFallow(['dupes']);
  } catch (e) {
    console.error(`Quality report incomplete — ${e.message}`);
    process.exit(2);
  }
  const summaryPath = join(cwd, 'coverage', 'coverage-summary.json');
  const coverageSummary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
  const { markdown, json } = buildReport(extractData({ healthJson, deadJson, dupesJson, coverageSummary }), runCmd);
  writeFileSync(join(cwd, 'quality-report.md'), markdown);
  writeFileSync(join(cwd, 'quality-report.json'), JSON.stringify(json, null, 2) + '\n');
  console.log('Wrote quality-report.md and quality-report.json');
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('quality-report.mjs');
if (invokedDirectly) main();
```

---

## See also

- [`build-ci/quality-integration-guide.md`](build-ci/quality-integration-guide.md)
  — how Claudian itself wires this harness, and the deliberate divergences.
- [`build-ci/quality-gates.md`](build-ci/quality-gates.md) — Claudian's
  authoritative gate catalogue, ratchet mechanics, and campaign history.
- [fallow](https://github.com/fallow-rs/fallow) — the analysis engine behind the
  metric ratchet and the advisory report.
