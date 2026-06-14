# Project-setup Skill — Harness Templates + Baseline (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the engine core (Plan 1) into a real quality-harness installer — render the ESLint / fallow / ratchet-script / Jest-or-Vitest / CI templates, install their deps, and initialize every ratchet **from the project's current state** so brownfield adoption stays green on day one.

**Architecture:** Extends Plan 1. New `Action` type `installDeps`; new sub-planners (`planEslint`, `planFallow`, `planLoc`, `planTest`, `planInstall`, `planCi`) composed by a `planHarness(options, state)` that `plan()` now includes. Baselines are not pipeline actions — after `apply` writes files and installs deps, `setup.mjs` runs `lib/baseline.mjs`, which simply drives the copied ratchet scripts' own `--update` mode (their `--update` already writes a from-current baseline) plus a coverage snapshot. `apply`/`baseline` take an injectable `exec` so tests never touch the network.

**Tech Stack:** Same as Plan 1 (Node built-ins, `node:test`). Templates target ESLint ≥9 flat config, fallow ≥2.9, Jest 30 **or** Vitest 2.

**Depends on:** Plan 1 (`lib/{detect,merge,plan,apply,options}.mjs`, the `Action` contract, the integration harness).

**Prereqs carried from Plan 1's self-review:** `installDeps` records pinned versions into `project-setup.report.json` (the spec's "pinned versions"); the coverage-absent ordering (spec Divergence) is enforced in `baseline.mjs`.

---

### Task 1: `templates` — load + render bundled template files

**Files:**
- Create: `.claude/skills/project-setup/scripts/lib/templates.mjs`
- Create: `.claude/skills/project-setup/scripts/templates/_smoke.tmpl` (a 1-line fixture proving `loadTemplate`)
- Test: `.claude/skills/project-setup/scripts/tests/templates.test.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/tests/templates.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadTemplate, renderTemplate } from '../lib/templates.mjs';

test('renderTemplate substitutes {{tokens}} and throws on a missing var', () => {
  assert.equal(renderTemplate('a {{x}} b', { x: 1 }), 'a 1 b');
  assert.throws(() => renderTemplate('{{missing}}', {}), /Template variable not provided: missing/);
});

test('loadTemplate reads a bundled template verbatim', () => {
  assert.match(loadTemplate('_smoke.tmpl'), /smoke {{name}}/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/tests/templates.test.js`
Expected: FAIL — module + template not found.

- [ ] **Step 3: Create the fixture template**

```
smoke {{name}}
```

(write that single line to `scripts/templates/_smoke.tmpl`)

- [ ] **Step 4: Implement**

```js
// scripts/lib/templates.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

export function renderTemplate(content, vars) {
  return content.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`Template variable not provided: ${name}`);
    return String(vars[name]);
  });
}

export function loadTemplate(name) {
  return readFileSync(join(TEMPLATES_DIR, name), 'utf8');
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test scripts/tests/templates.test.js` → PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/templates.mjs scripts/templates/_smoke.tmpl scripts/tests/templates.test.js
git commit -m "feat(project-setup): template load + render primitive"
```

---

### Task 2: `installDeps` action + injectable exec in `apply`

**Files:**
- Modify: `.claude/skills/project-setup/scripts/lib/apply.mjs`
- Test: `.claude/skills/project-setup/scripts/tests/apply-install.test.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/tests/apply-install.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apply } from '../lib/apply.mjs';
import { tmpProject } from './helpers.js';

test('installDeps runs the package manager when package.json changed, and is not a tracked change', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const calls = [];
  const exec = (cmd, args, opts) => calls.push({ cmd, args, cwd: opts.cwd });
  try {
    const res = apply([
      { type: 'mergeJson', path: 'package.json', patch: { devDependencies: { left: '1.0.0' } } },
      { type: 'installDeps', packageManager: 'pnpm' },
    ], { cwd: p.dir, exec });
    assert.deepEqual(calls, [{ cmd: 'pnpm', args: ['install'], cwd: p.dir }]);
    assert.ok(res.planned.includes('(install)')); // install is previewed in the plan
    assert.ok(!res.changed.includes('(install)')); // install is an effect, not a tracked change
  } finally {
    p.cleanup();
  }
});

test('installDeps is skipped when package.json did not change (idempotent re-apply)', () => {
  const p = tmpProject({ 'package.json': { name: 'x', devDependencies: { left: '1.0.0' } } });
  const calls = [];
  try {
    apply([
      { type: 'mergeJson', path: 'package.json', patch: { devDependencies: { left: '1.0.0' } } },
      { type: 'installDeps', packageManager: 'npm' },
    ], { cwd: p.dir, exec: (...a) => calls.push(a) });
    assert.equal(calls.length, 0); // package.json already converged -> no install
  } finally {
    p.cleanup();
  }
});

test('installDeps is skipped in dry-run but still appears in planned', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const calls = [];
  try {
    const res = apply([{ type: 'installDeps', packageManager: 'npm' }], { cwd: p.dir, dryRun: true, exec: (...a) => calls.push(a) });
    assert.equal(calls.length, 0);
    assert.ok(res.planned.includes('(install)'));
  } finally {
    p.cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/tests/apply-install.test.js`
Expected: FAIL — `Unknown action type: installDeps`.

- [ ] **Step 3: Implement — add the exec option and the action branch**

At the top of `apply.mjs`, add the import and a default exec:

```js
import { execFileSync } from 'node:child_process';
```

In `apply(actions, opts = {})`, add after the existing `const backupDir = ...` line:

```js
  const exec =
    opts.exec ?? ((cmd, args, options) => execFileSync(cmd, args, { stdio: 'inherit', ...options }));
```

Add this branch at the top of the loop (before `const abs = join(...)`) so it `continue`s early:

```js
    if (action.type === 'installDeps') {
      // Always include in the plan so dry-run/plan previews the install side effect.
      // NEVER push to `changed`: install is an effect, not a tracked file mutation,
      // so a converged re-apply stays a no-op and the baseline hook does not re-run.
      planned.push('(install)');
      if (!dryRun && changed.includes('package.json')) exec(action.packageManager, ['install'], { cwd });
      continue;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/tests/apply-install.test.js` → PASS (2 tests). Also re-run `node --test scripts/tests/apply.test.js` → still PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/apply.mjs scripts/tests/apply-install.test.js
git commit -m "feat(project-setup): installDeps action with injectable exec"
```

---

### Task 3: ESLint template + `planEslint`

**Files:**
- Create: `.claude/skills/project-setup/scripts/templates/eslint.config.mjs.tmpl`
- Create: `.claude/skills/project-setup/scripts/lib/harness.mjs`
- Test: `.claude/skills/project-setup/scripts/tests/harness-eslint.test.js`

The template is a generalized flat config: keeps the portable guardrails (no-console, no-explicit-any, import sort, consistent-type-imports, function-health) and the severity-staging `warn` tier; drops Claudian-specifics (obsidian rules, provider-boundary imports, Notice-i18n). The `{{testPlugin}}` / `{{testGlobals}}` tokens are filled by `planTest` in Task 5 — for Task 3 the planner renders only the non-test portion.

- [ ] **Step 1: Write the failing test**

```js
// scripts/tests/harness-eslint.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planEslint } from '../lib/harness.mjs';

const opts = { typescript: true, guardrails: { eslintSeverityStaging: true } };

test('planEslint writes a flat config (skip-if-exists) and adds the lint script + deps', () => {
  const actions = planEslint(opts);
  const cfg = actions.find((a) => a.path === 'eslint.config.mjs');
  assert.equal(cfg.type, 'writeFile');
  assert.equal(cfg.mode, 'skip-if-exists'); // never clobber an existing config
  assert.match(cfg.content, /no-console/);
  assert.match(cfg.content, /simple-import-sort/);

  const pkg = actions.find((a) => a.type === 'mergeJson' && a.path === 'package.json');
  assert.equal(pkg.patch.scripts.lint, 'eslint .');
  assert.ok('eslint' in pkg.patch.devDependencies);
});

test('planEslint is a no-op when the guardrail is disabled', () => {
  assert.deepEqual(planEslint({ guardrails: { eslintSeverityStaging: false } }), []);
});

test('planEslint wires the test-lint plugin for the resolved framework', () => {
  const jestCfg = planEslint({ testFramework: 'jest', guardrails: { eslintSeverityStaging: true } })
    .find((a) => a.path === 'eslint.config.mjs');
  assert.match(jestCfg.content, /eslint-plugin-jest/);
  const vitestCfg = planEslint({ testFramework: 'vitest', guardrails: { eslintSeverityStaging: true } })
    .find((a) => a.path === 'eslint.config.mjs');
  assert.match(vitestCfg.content, /eslint-plugin-vitest/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/tests/harness-eslint.test.js`
Expected: FAIL — `Cannot find module '../lib/harness.mjs'`.

- [ ] **Step 3: Create the ESLint template**

```
// scripts/templates/eslint.config.mjs.tmpl
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
{{testImport}}
// Generated by project-setup. Two-tier severity policy: `error` blocks CI,
// `warn` stages a backlog (CI does not pass --max-warnings). Promote warn->error
// as each backlog reaches zero. See docs/quality-integration-guide.md.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      complexity: ['error', { max: 25 }],
      'max-lines-per-function': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', { max: 6 }],
      'max-depth': ['error', { max: 5 }],
    },
  },
{{testConfigBlock}}
];
```

- [ ] **Step 4: Implement `planEslint` in `harness.mjs`**

```js
// scripts/lib/harness.mjs
import { loadTemplate, renderTemplate } from './templates.mjs';

// EXACT pins (no caret/tilde). A first install with no lockfile must be
// reproducible — same answers + same state => same installed versions, per the
// spec's determinism guarantee. The resolved versions are also recorded in
// project-setup.report.json. Refresh deliberately to current exact releases
// (verify each with `npm view <pkg> version` when bumping).
export const PINNED = {
  eslint: '9.36.0',
  'typescript-eslint': '8.45.0',
  '@eslint/js': '9.36.0',
  'eslint-plugin-simple-import-sort': '12.1.1',
  fallow: '2.91.0',
  jest: '30.3.0',
  'ts-jest': '29.4.9',
  '@types/jest': '30.0.0',
  'eslint-plugin-jest': '28.14.0',
  vitest: '2.1.9',
  '@vitest/coverage-istanbul': '2.1.9',
  'eslint-plugin-vitest': '0.5.4',
  typescript: '5.9.3',
};

function dep(...names) {
  return Object.fromEntries(names.map((n) => [n, PINNED[n]]));
}

// Test-lint plugin wiring by framework. Empty when no framework (so eslint still
// installs); jest/vitest get their recommended test rules imported AND applied —
// otherwise the installed plugin would never run.
function eslintTestBlock(fw) {
  if (fw === 'jest') {
    return {
      testImport: "import jestPlugin from 'eslint-plugin-jest';",
      testConfigBlock: "  { files: ['**/*.{test,spec}.{ts,tsx,js,jsx}'], ...jestPlugin.configs['flat/recommended'] },",
    };
  }
  if (fw === 'vitest') {
    return {
      testImport: "import vitestPlugin from 'eslint-plugin-vitest';",
      testConfigBlock: "  { files: ['**/*.{test,spec}.{ts,tsx,js,jsx}'], plugins: { vitest: vitestPlugin }, rules: vitestPlugin.configs.recommended.rules },",
    };
  }
  return { testImport: '', testConfigBlock: '' };
}

export function planEslint(options) {
  if (!options.guardrails?.eslintSeverityStaging) return [];
  // Render the test-lint plugin import + config from the (resolved) test
  // framework so the test-lint guardrails actually run (setup.mjs resolves
  // options.testFramework before plan()).
  const { testImport, testConfigBlock } = eslintTestBlock(options.testFramework);
  const content = renderTemplate(loadTemplate('eslint.config.mjs.tmpl'), { testImport, testConfigBlock });
  return [
    { type: 'writeFile', path: 'eslint.config.mjs', mode: 'skip-if-exists', content },
    {
      type: 'mergeJson',
      path: 'package.json',
      patch: {
        scripts: { lint: 'eslint .', 'lint:fix': 'eslint . --fix' },
        devDependencies: dep('eslint', 'typescript-eslint', '@eslint/js', 'eslint-plugin-simple-import-sort'),
      },
    },
  ];
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test scripts/tests/harness-eslint.test.js` → PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/templates/eslint.config.mjs.tmpl scripts/lib/harness.mjs scripts/tests/harness-eslint.test.js
git commit -m "feat(project-setup): ESLint template + planEslint sub-planner"
```

---

### Task 4: fallow template + `check-quality.mjs` + `planFallow`

**Files:**
- Create: `.claude/skills/project-setup/scripts/templates/fallowrc.json.tmpl`
- Create: `.claude/skills/project-setup/scripts/templates/check-quality.mjs`
- Modify: `.claude/skills/project-setup/scripts/lib/harness.mjs` (add `planFallow`)
- Test: `.claude/skills/project-setup/scripts/tests/harness-fallow.test.js`

- [ ] **Step 1: Create the fallow template** (generalized: no boundary zones; `unused-dependencies` staged at warn)

```
// scripts/templates/fallowrc.json.tmpl
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  "entry": ["{{entry}}"],
  "ignorePatterns": ["**/docs/**", "**/coverage/**", "**/dist/**", "**/.fallow/**"],
  "duplicates": { "minOccurrences": 2, "ignore": ["**/tests/**", "**/*.test.*"] },
  "rules": { "unused-dependencies": "warn" }
}
```

- [ ] **Step 2: Create `templates/check-quality.mjs`**

Author this by copying **this repo's** `scripts/check-quality.mjs` verbatim, then making exactly these generalizing edits (the file is portable except for two Claudian-only structural metrics that only exist when fallow boundary zones are configured):

1. In the `METRICS` object, **delete** the entire `reExportCycles` entry and the entire `boundaryViolations` entry (keep `circularDependencies`, `deadCodeIssues`, `cloneGroups`, `duplicatedLines`, `complexFunctions`, `criticalComplexity`, `averageMaintainability`).
2. In the header comment, **delete** the parenthetical "+ ADR 0001 boundary enforcement" and any reference to `.fallowrc.json` "boundaries"; replace with "(import-cycle budget)".
3. Leave everything else (the ratchet logic, `--update`, `--json`, exit codes) unchanged.

The result is a standalone script with no Claudian references. Verify after copying:

Run: `node scripts/templates/check-quality.mjs --help 2>&1 | head -1` (should not throw a syntax error; it will report a missing baseline, which is expected here).

- [ ] **Step 3: Write the failing test**

```js
// scripts/tests/harness-fallow.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planFallow } from '../lib/harness.mjs';

test('planFallow renders .fallowrc.json with the detected entry and copies the ratchet script', () => {
  const actions = planFallow({ guardrails: { fallowRatchet: true } }, { entry: 'src/index.ts' });
  const rc = actions.find((a) => a.path === '.fallowrc.json');
  assert.match(rc.content, /"src\/index\.ts"/);
  assert.ok(actions.some((a) => a.path === 'scripts/check-quality.mjs' && a.type === 'writeFile'));
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts['check:quality'], 'node scripts/check-quality.mjs');
  assert.equal(pkg.patch.scripts.quality, 'fallow');
});

test('planFallow is a no-op when disabled', () => {
  assert.deepEqual(planFallow({ guardrails: { fallowRatchet: false } }, {}), []);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `node --test scripts/tests/harness-fallow.test.js`
Expected: FAIL — `planFallow` is not exported.

- [ ] **Step 5: Implement `planFallow`** (append to `harness.mjs`)

`harness.mjs` already imports `loadTemplate`/`renderTemplate` (Task 3) and defines `dep` — reuse both. Append:

```js
export function planFallow(options, state) {
  if (!options.guardrails?.fallowRatchet) return [];
  const entry = state?.entry ?? 'src/index.ts';
  return [
    {
      type: 'writeFile',
      path: '.fallowrc.json',
      mode: 'skip-if-exists',
      content: renderTemplate(loadTemplate('fallowrc.json.tmpl'), { entry }),
    },
    {
      type: 'writeFile',
      path: 'scripts/check-quality.mjs',
      mode: 'overwrite-backup',
      content: loadTemplate('check-quality.mjs'),
    },
    {
      type: 'mergeJson',
      path: 'package.json',
      patch: {
        scripts: {
          quality: 'fallow',
          'quality:audit': 'fallow audit',
          'check:quality': 'node scripts/check-quality.mjs',
        },
        devDependencies: dep('fallow'),
      },
    },
  ];
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `node --test scripts/tests/harness-fallow.test.js` → PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/templates/fallowrc.json.tmpl scripts/templates/check-quality.mjs scripts/lib/harness.mjs scripts/tests/harness-fallow.test.js
git commit -m "feat(project-setup): fallow config + ratchet script template + planFallow"
```

---

### Task 5: LOC guard, Jest/Vitest, and `planLoc` / `planTest`

**Files:**
- Create: `.claude/skills/project-setup/scripts/templates/check-loc.mjs`
- Create: `.claude/skills/project-setup/scripts/templates/jest.config.mjs.tmpl`
- Create: `.claude/skills/project-setup/scripts/templates/vitest.config.mjs.tmpl`
- Modify: `.claude/skills/project-setup/scripts/lib/harness.mjs` (add `planLoc`, `planTest`)
- Test: `.claude/skills/project-setup/scripts/tests/harness-test.test.js`

- [ ] **Step 1: Create `templates/check-loc.mjs.tmpl`** (generic LOC ratchet — fresh, standalone; filename is `.tmpl` so `planLoc` can render `{{locCap}}`)

```js
// scripts/templates/check-loc.mjs.tmpl
#!/usr/bin/env node
/* Generated by project-setup. Ratchets per-file nonblank LOC vs scripts/loc-baseline.json.
 * Files <= maxLoc are fine; grandfathered hotspots may shrink but not grow.
 * `--update` rewrites the baseline from the current state (use at adoption). */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const BASELINE = join(ROOT, 'scripts', 'loc-baseline.json');
const MAX_LOC = {{locCap}};
const SRC = join(ROOT, 'src');
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const update = process.argv.includes('--update');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
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

- [ ] **Step 2: Create the test-framework templates**

`scripts/templates/jest.config.mjs.tmpl`:

```
// Generated by project-setup.
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  // Coverage thresholds are written by project-setup's baseline step (current
  // coverage becomes a rise-only floor). Run the ratchet (check:quality) with
  // ./coverage ABSENT — a stray coverage dir flips fallow CRAP and spikes
  // critical-complexity findings.
  coverageThreshold: { global: {{coverageThreshold}} },
};
```

`scripts/templates/vitest.config.mjs.tmpl`:

```
// Generated by project-setup.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul', // istanbul so fallow's CRAP can read ./coverage
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {{coverageThreshold}},
    },
  },
});
```

- [ ] **Step 3: Write the failing test**

```js
// scripts/tests/harness-test.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planLoc, planTest } from '../lib/harness.mjs';

test('planLoc copies check-loc.mjs and adds the check:loc script', () => {
  const actions = planLoc({ guardrails: { locGuard: true } });
  assert.ok(actions.some((a) => a.path === 'scripts/check-loc.mjs'));
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts['check:loc'], 'node scripts/check-loc.mjs');
});

test('planLoc renders the locCap into MAX_LOC', () => {
  const actions = planLoc({ guardrails: { locGuard: true }, locCap: 300 });
  const file = actions.find((a) => a.path === 'scripts/check-loc.mjs');
  assert.match(file.content, /MAX_LOC = 300/);
});

test('planTest(jest) renders jest config + jest deps + test scripts', () => {
  const actions = planTest({ testFramework: 'jest', guardrails: { coverageFloors: true } });
  const cfg = actions.find((a) => a.path === 'jest.config.mjs');
  assert.match(cfg.content, /ts-jest/);
  assert.match(cfg.content, /"100"|\{[^}]*\}/); // placeholder threshold rendered to a JSON object
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.test, 'jest --passWithNoTests');
  assert.equal(pkg.patch.scripts['test:coverage'], 'jest --coverage --passWithNoTests');
  assert.ok('jest' in pkg.patch.devDependencies);
});

test('planTest(vitest) renders vitest config with the istanbul provider', () => {
  const actions = planTest({ testFramework: 'vitest', guardrails: { coverageFloors: true } });
  const cfg = actions.find((a) => a.path === 'vitest.config.mjs');
  assert.match(cfg.content, /istanbul/);
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.test, 'vitest run --passWithNoTests');
  assert.ok('@vitest/coverage-istanbul' in pkg.patch.devDependencies);
});

test('planTest falls back to the DETECTED framework when no explicit answer', () => {
  // options.testFramework null (user accepted the default) + detected vitest.
  const actions = planTest({ testFramework: null, guardrails: {} }, { testFramework: 'vitest' });
  assert.ok(actions.some((a) => a.path === 'vitest.config.mjs'));
  assert.ok(!actions.some((a) => a.path === 'jest.config.mjs'));
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `node --test scripts/tests/harness-test.test.js`
Expected: FAIL — `planLoc`/`planTest` not exported.

- [ ] **Step 5: Implement `planLoc` and `planTest`** (append to `harness.mjs`)

```js
export function planLoc(options) {
  if (!options.guardrails?.locGuard) return [];
  return [
    { type: 'writeFile', path: 'scripts/check-loc.mjs', mode: 'overwrite-backup', content: renderTemplate(loadTemplate('check-loc.mjs.tmpl'), { locCap: String(options.locCap ?? 500) }) },
    { type: 'mergeJson', path: 'package.json', patch: { scripts: { 'check:loc': 'node scripts/check-loc.mjs' } } },
  ];
}

export function planTest(options, state) {
  // Prefer an explicit answer, else the framework detected in the repo, else
  // Jest. This keeps a brownfield Vitest project on Vitest when the user accepts
  // the detected default.
  const fw = options.testFramework ?? state?.testFramework ?? 'jest';
  // Thresholds are filled by baseline; until then default to 0 (a no-op floor)
  // rendered as a JSON object so the config is valid immediately.
  const coverageThreshold = JSON.stringify(
    options.guardrails?.coverageFloors ? { statements: 0, branches: 0, functions: 0, lines: 0 } : {},
  );
  if (fw === 'vitest') {
    return [
      { type: 'writeFile', path: 'vitest.config.mjs', mode: 'skip-if-exists', content: renderTemplate(loadTemplate('vitest.config.mjs.tmpl'), { coverageThreshold }) },
      { type: 'mergeJson', path: 'package.json', patch: { scripts: { test: 'vitest run --passWithNoTests', 'test:coverage': 'vitest run --coverage --passWithNoTests' }, devDependencies: dep('vitest', '@vitest/coverage-istanbul', 'eslint-plugin-vitest', 'typescript') } },
    ];
  }
  return [
    { type: 'writeFile', path: 'jest.config.mjs', mode: 'skip-if-exists', content: renderTemplate(loadTemplate('jest.config.mjs.tmpl'), { coverageThreshold }) },
    { type: 'mergeJson', path: 'package.json', patch: { scripts: { test: 'jest --passWithNoTests', 'test:coverage': 'jest --coverage --passWithNoTests' }, devDependencies: dep('jest', 'ts-jest', '@types/jest', 'eslint-plugin-jest', 'typescript') } },
  ];
}
```

The top of `harness.mjs` should have exactly one templates import: `import { loadTemplate, renderTemplate } from './templates.mjs';`.

- [ ] **Step 6: Run to verify it passes**

Run: `node --test scripts/tests/harness-test.test.js` → PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/templates/check-loc.mjs scripts/templates/jest.config.mjs.tmpl scripts/templates/vitest.config.mjs.tmpl scripts/lib/harness.mjs scripts/tests/harness-test.test.js
git commit -m "feat(project-setup): LOC guard + Jest/Vitest templates and planners"
```

---

### Task 6: CI template + `planCi` (GitHub opt-in) and `planInstall`

**Files:**
- Create: `.claude/skills/project-setup/scripts/templates/ci.yml.tmpl`
- Modify: `.claude/skills/project-setup/scripts/lib/harness.mjs` (add `planCi`, `planInstall`)
- Test: `.claude/skills/project-setup/scripts/tests/harness-ci.test.js`

- [ ] **Step 1: Create the CI template**

```
# scripts/templates/ci.yml.tmpl
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
{{pmSetup}}      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: {{pmCache}} }
      - run: {{pmInstall}}
{{steps}}
```

- [ ] **Step 2: Write the failing test**

```js
// scripts/tests/harness-ci.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planCi, planInstall } from '../lib/harness.mjs';

test('planCi only emits the workflow when GitHub integration is opted in', () => {
  assert.deepEqual(planCi({ github: { integrate: false }, guardrails: { ci: true } }, { packageManager: 'npm' }), []);
  const actions = planCi(
    { github: { integrate: true }, guardrails: { ci: true, eslintSeverityStaging: true, locGuard: true, fallowRatchet: true, coverageFloors: true } },
    { packageManager: 'npm' },
  );
  const wf = actions.find((a) => a.path === '.github/workflows/ci.yml');
  assert.equal(wf.mode, 'skip-if-exists');
  assert.match(wf.content, /npm ci/);
  assert.match(wf.content, /npm run lint/);
  assert.match(wf.content, /npm run check:loc/);
  assert.match(wf.content, /npm run check:quality/);
  assert.match(wf.content, /npm run test:coverage/);
});

test('planCi gates each step on its guardrail flag (no step for a disabled guardrail)', () => {
  const actions = planCi(
    { github: { integrate: true }, guardrails: { ci: true, eslintSeverityStaging: true, locGuard: false, fallowRatchet: false, coverageFloors: false } },
    { packageManager: 'npm' },
  );
  const wf = actions.find((a) => a.path === '.github/workflows/ci.yml');
  assert.match(wf.content, /npm run lint/);
  assert.doesNotMatch(wf.content, /check:loc/); // guardrail off -> script absent -> no step
  assert.doesNotMatch(wf.content, /check:quality/);
  assert.match(wf.content, /npm run test\b/); // base test step always present
  assert.doesNotMatch(wf.content, /test:coverage/);
});

test('planCi renders the detected package manager (pnpm)', () => {
  const actions = planCi(
    { github: { integrate: true }, guardrails: { ci: true, fallowRatchet: true } },
    { packageManager: 'pnpm' },
  );
  const wf = actions.find((a) => a.path === '.github/workflows/ci.yml');
  assert.match(wf.content, /pnpm\/action-setup/);
  assert.match(wf.content, /pnpm install --frozen-lockfile/);
  assert.match(wf.content, /cache: pnpm/);
  assert.match(wf.content, /pnpm check:quality/);
});

test('planInstall emits one installDeps action for the detected package manager', () => {
  assert.deepEqual(planInstall({}, { packageManager: 'pnpm' }), [{ type: 'installDeps', packageManager: 'pnpm' }]);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test scripts/tests/harness-ci.test.js`
Expected: FAIL — `planCi`/`planInstall` not exported.

- [ ] **Step 4: Implement** (append to `harness.mjs`)

```js
// Per-package-manager CI rendering. npm/pnpm/yarn are fully supported; an
// unknown manager (incl. bun) falls back to npm-style so the workflow is valid.
const CI_PM = {
  npm: { setup: '', cache: 'npm', install: 'npm ci', run: 'npm run' },
  pnpm: { setup: '      - uses: pnpm/action-setup@v4\n', cache: 'pnpm', install: 'pnpm install --frozen-lockfile', run: 'pnpm' },
  yarn: { setup: '', cache: 'yarn', install: 'yarn install --immutable', run: 'yarn' },
};

export function planCi(options, state) {
  if (!options.github?.integrate || !options.guardrails?.ci) return [];
  const g = options.guardrails ?? {};
  const pm = CI_PM[state?.packageManager] ?? CI_PM.npm;
  // Emit a CI step only for a guardrail that is actually installed (its npm
  // script exists). The test step is always present; it uses the coverage
  // variant when coverage floors are on.
  const steps = [];
  if (g.eslintSeverityStaging) steps.push(`      - run: ${pm.run} lint`);
  if (g.locGuard) steps.push(`      - run: ${pm.run} check:loc`);
  if (g.fallowRatchet) steps.push(`      - run: ${pm.run} check:quality   # runs with ./coverage absent`);
  steps.push(`      - run: ${pm.run} ${g.coverageFloors ? 'test:coverage' : 'test'}`);
  const content = renderTemplate(loadTemplate('ci.yml.tmpl'), {
    pmSetup: pm.setup, pmCache: pm.cache, pmInstall: pm.install, steps: steps.join('\n'),
  });
  return [{ type: 'writeFile', path: '.github/workflows/ci.yml', mode: 'skip-if-exists', content }];
}

export function planInstall(options, state) {
  return [{ type: 'installDeps', packageManager: state?.packageManager ?? 'npm' }];
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test scripts/tests/harness-ci.test.js` → PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/templates/ci.yml.tmpl scripts/lib/harness.mjs scripts/tests/harness-ci.test.js
git commit -m "feat(project-setup): CI workflow template (opt-in) + planInstall"
```

---

### Task 7: `baseline.mjs` — snapshot current state (brownfield-safe)

**Files:**
- Create: `.claude/skills/project-setup/scripts/lib/baseline.mjs`
- Test: `.claude/skills/project-setup/scripts/tests/baseline.test.js`

`initBaselines` drives the already-copied ratchet scripts' `--update` mode (which writes a from-current baseline) and snapshots coverage. **Ordering matters:** quality + LOC baselines run first (with `./coverage` absent so fallow CRAP stays `static_estimated`), then the coverage snapshot runs last (it creates `./coverage`).

- [ ] **Step 1: Write the failing test**

```js
// scripts/tests/baseline.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initBaselines } from '../lib/baseline.mjs';
import { tmpProject } from './helpers.js';

test('initBaselines updates fallow + LOC before coverage, only for enabled guardrails', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const order = [];
  const exec = (cmd, args) => order.push(`${cmd} ${args.join(' ')}`);
  try {
    initBaselines(p.dir, { guardrails: { fallowRatchet: true, locGuard: true, coverageFloors: false } }, exec);
    assert.deepEqual(order, [
      'node scripts/check-quality.mjs --update',
      'node scripts/check-loc.mjs --update',
    ]);
  } finally {
    p.cleanup();
  }
});

test('coverage baseline runs last and is skipped when the guardrail is off', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const order = [];
  try {
    initBaselines(p.dir, { testFramework: 'jest', guardrails: { coverageFloors: true } },
      (cmd, args) => order.push(`${cmd} ${args.join(' ')}`));
    assert.equal(order[order.length - 1], 'npm run test:coverage');
  } finally {
    p.cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/tests/baseline.test.js`
Expected: FAIL — `Cannot find module '../lib/baseline.mjs'`.

- [ ] **Step 2b: Create `lib/packageManager.mjs`** (package-manager-aware run-script helper; imported by baseline and verify)

```js
// scripts/lib/packageManager.mjs

// Args to run a package.json script with the given manager (matches CI/verify).
export function runScriptArgs(pm, script) {
  switch (pm) {
    case 'pnpm': return ['pnpm', [script]];
    case 'yarn': return ['yarn', [script]];
    case 'bun': return ['bun', ['run', script]];
    default: return ['npm', ['run', script]];
  }
}
```

Test (`scripts/tests/packageManager.test.js`):

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScriptArgs } from '../lib/packageManager.mjs';

test('runScriptArgs(pnpm) returns [pnpm, [script]] (no run subcommand)', () => {
  assert.deepEqual(runScriptArgs('pnpm', 'test:coverage'), ['pnpm', ['test:coverage']]);
});
test('runScriptArgs(npm) returns [npm, [run, script]]', () => {
  assert.deepEqual(runScriptArgs('npm', 'test:coverage'), ['npm', ['run', 'test:coverage']]);
});
test('runScriptArgs(bun) returns [bun, [run, script]]', () => {
  assert.deepEqual(runScriptArgs('bun', 'test:coverage'), ['bun', ['run', 'test:coverage']]);
});
```

- [ ] **Step 3: Implement**

```js
// scripts/lib/baseline.mjs
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { runScriptArgs } from './packageManager.mjs';

const defaultExec = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// Snapshot today's debt as the bar. Order: fallow + LOC first (coverage absent
// so CRAP stays static_estimated), coverage last (it creates ./coverage).
export function initBaselines(cwd, options, exec = defaultExec) {
  const g = options.guardrails ?? {};
  if (g.fallowRatchet) exec('node', ['scripts/check-quality.mjs', '--update'], { cwd });
  if (g.locGuard) exec('node', ['scripts/check-loc.mjs', '--update'], { cwd });
  if (g.coverageFloors) {
    // Delete any pre-existing coverage dir so the ratchet snapshots static-estimated
    // CRAP (matching CI, which has no coverage artifact).
    rmSync(join(cwd, 'coverage'), { recursive: true, force: true });
    // Running coverage produces ./coverage and a coverage-summary; a follow-up
    // step (Plan 3 report / a coverage helper) reads it to set the floor.
    const [cmd, cargs] = runScriptArgs(options.packageManager ?? 'npm', 'test:coverage');
    exec(cmd, cargs, { cwd });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/tests/baseline.test.js` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/baseline.mjs scripts/tests/baseline.test.js
git commit -m "feat(project-setup): baseline init drives ratchet --update, coverage last"
```

---

### Task 8: Compose `planHarness` into `plan()` and wire `apply` → baseline

**Files:**
- Modify: `.claude/skills/project-setup/scripts/lib/plan.mjs` (add `planHarness`, call it in `plan`)
- Modify: `.claude/skills/project-setup/scripts/setup.mjs` (run `initBaselines` after a real apply)
- Test: `.claude/skills/project-setup/scripts/tests/harness-integration.test.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/tests/harness-integration.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plan } from '../lib/plan.mjs';

const options = {
  testFramework: 'vitest',
  guardrails: { fallowRatchet: true, locGuard: true, eslintSeverityStaging: true, coverageFloors: true, ci: true },
  github: { integrate: true },
  docs: {},
};
const state = { packageManager: 'npm', entry: 'src/index.ts' };

test('plan now includes harness actions in a sane order (writes/deps before install)', () => {
  const actions = plan(options, state);
  const paths = actions.map((a) => a.path ?? `(${a.type})`);
  assert.ok(paths.includes('eslint.config.mjs'));
  assert.ok(paths.includes('.fallowrc.json'));
  assert.ok(paths.includes('vitest.config.mjs'));
  assert.ok(paths.includes('.github/workflows/ci.yml'));
  // install must come after all the file writes/merges
  const installIdx = actions.findIndex((a) => a.type === 'installDeps');
  const lastWriteIdx = actions.map((a) => a.type).lastIndexOf('writeFile');
  assert.ok(installIdx > lastWriteIdx, 'installDeps should be planned after file writes');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/tests/harness-integration.test.js`
Expected: FAIL — harness actions absent from `plan()`.

- [ ] **Step 3: Add `planHarness` and call it** — modify `plan.mjs`

Add the import at the top:

```js
import { planCi, planEslint, planFallow, planInstall, planLoc, planTest } from './harness.mjs';
```

Add the composer (ordered: file writes/merges first, install last):

```js
function planHarness(options, state) {
  return [
    ...planEslint(options, state),
    ...planFallow(options, state),
    ...planLoc(options, state),
    ...planTest(options, state),
    ...planCi(options, state),
    ...planInstall(options, state), // must be last so deps are in package.json first
  ];
}
```

Change the exported `plan` to splice harness between gitignore and the run report:

```js
export function plan(options, state) {
  return [
    ...planGitignore(options, state),
    ...planHarness(options, state),
    ...planRunReport(options, state),
  ];
}
```

- [ ] **Step 4: Wire `apply` → `initBaselines` in `setup.mjs`**

Add the import: `import { initBaselines } from './lib/baseline.mjs';`

In the `apply`/`plan` branch (from Plan 1 Task 6) the handler currently does
`const actions = plan(options, detect(cwd));`. Change it to capture `state` once
and **resolve the test framework** so every downstream planner *and* the baseline
agree (this preserves a brownfield project's existing Jest/Vitest):

```js
      const options = loadOptions(resolve(cwd, args.flags.config));
      const state = detect(cwd);
      options.testFramework = options.testFramework ?? state.testFramework ?? 'jest';
      options.packageManager = options.packageManager ?? state.packageManager;
      const actions = plan(options, state);
```

Then, after `const result = apply(...)` and before the output block, add:

```js
      if (!dryRun && result.changed.length > 0) {
        initBaselines(cwd, options); // snapshot current debt (brownfield-safe)
      }
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test scripts/tests/harness-integration.test.js` → PASS. Also run the **whole** suite: `node --test scripts/tests/` → all green.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/plan.mjs scripts/setup.mjs scripts/tests/harness-integration.test.js
git commit -m "feat(project-setup): compose harness into plan() and run baselines after apply"
```

---

## Self-review (against the spec, harness scope)

- **Full toggleable harness:** fallow ratchet (T4), LOC guard (T5), ESLint severity-staging (T3), coverage floors (T5 + baseline T7), CI (T6) — each gated on its `guardrails.*` flag and a no-op when off ✓.
- **Jest-or-Vitest (spec):** `planTest` branches; Vitest pinned to `@vitest/coverage-istanbul` so fallow CRAP reads `./coverage` ✓; the coverage-absent caveat is in the jest/vitest config comments and enforced by `initBaselines` ordering ✓.
- **Brownfield baseline-from-current (spec + Codex fix):** `initBaselines` drives `check-quality --update` / `check-loc --update` (from-current) and the coverage snapshot runs **last** ✓. Coverage floor is staged at 0 in the template until the snapshot sets it — green on day one ✓.
- **Non-destructive (spec):** configs use `skip-if-exists`; the two ratchet scripts use `overwrite-backup` (regeneratable, backed up) ✓.
- **Pinned versions (Plan 1 carry-over):** `PINNED` map; recorded into `package.json` and the run report ✓.
- **Generalization:** templates strip Claudian-specifics; `check-quality.mjs` copy carries an explicit, exact two-metric deletion (not a vague instruction) ✓.
- **Deferred to Plan 3 (correct):** the coverage-floor *value* writer (reads `coverage-summary.json` → sets the threshold), `quality-report.mjs`, `report`/`verify` CLI, docs scaffold, SKILL.md, grill, GitHub MCP/branch-protection. Listed so nothing is lost.
- **Placeholder scan:** every step ships runnable code or an exact command; no aliased/dead imports, no "TBD". The one cross-task invariant (a single `templates.mjs` import in `harness.mjs`) is stated explicitly in T5.
