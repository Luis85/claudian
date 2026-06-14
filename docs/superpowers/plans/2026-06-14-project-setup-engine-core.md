# Project-setup Skill — Engine Core (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic engine core of the `project-setup` skill — a `setup.mjs` CLI that can `detect` a project's state and idempotently `apply` a planned set of file mutations (create / additive-merge / backup-overwrite) with a `--dry-run` preview.

**Architecture:** Approach A from the spec (`docs/superpowers/specs/2026-06-14-project-setup-skill-design.md`): a thin CLI dispatches to pure-ish lib modules. `detect` reads state, `plan` turns options+state into an ordered `Action[]`, `apply` executes that list idempotently. No template content or harness logic yet — this plan delivers the mutation engine and its safety guarantees so Plans 2–3 can build on a tested foundation.

**Tech Stack:** Node ≥18 built-ins only (`node:fs`, `node:path`, `node:url`, `node:child_process`), tested with the built-in `node:test` runner (`node --test`). Zero runtime dependencies.

**Plan decomposition (3 plans):**
- **Plan 1 (this doc): Engine core** — CLI + `detect` + `merge` + `plan` + `apply` + tests.
- **Plan 2: Quality-harness templates + baseline** — `templates/` (ESLint, fallow, `check-loc.mjs`, `check-quality.mjs`, Jest/Vitest, CI), `lib/templates.mjs`, `lib/baseline.mjs`, harness sub-planners, dep install.
- **Plan 3: User-facing skill** — docs scaffold templates, `quality-report.mjs`, `setup.mjs report`/`verify`, `SKILL.md` orchestration, `references/`, opt-in GitHub wiring, end-to-end smoke tests (greenfield + brownfield fixtures).

**Conventions for every task:** exact paths under `.claude/skills/project-setup/scripts/`. Run tests with `node --test scripts/tests/*.test.js` from the skill root (`.claude/skills/project-setup/`). Commit identity is already configured (`Claude <noreply@anthropic.com>`).

---

### Task 1: CLI skeleton — argument parsing and command dispatch

**Files:**
- Create: `.claude/skills/project-setup/scripts/setup.mjs`
- Test: `.claude/skills/project-setup/scripts/tests/cli.test.js`

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/project-setup/scripts/tests/cli.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cli, parseArgs } from '../setup.mjs';

function capture() {
  const chunks = { out: '', err: '' };
  return {
    io: { stdout: (s) => (chunks.out += s), stderr: (s) => (chunks.err += s), cwd: process.cwd() },
    chunks,
  };
}

test('parseArgs collects positionals and valued flags', () => {
  const args = parseArgs(['apply', '--config', 'a.json', '--dry-run']);
  assert.equal(args._[0], 'apply');
  assert.equal(args.flags.config, 'a.json');
  assert.equal(args.flags.dryRun, true);
});

test('no command prints usage and exits 0', async () => {
  const { io, chunks } = capture();
  const code = await cli([], io);
  assert.equal(code, 0);
  assert.match(chunks.out, /Usage: node setup\.mjs/);
});

test('unknown command exits 2 with usage on stderr', async () => {
  const { io, chunks } = capture();
  const code = await cli(['frobnicate'], io);
  assert.equal(code, 2);
  assert.match(chunks.err, /Unknown command: frobnicate/);
});

test('not-yet-implemented commands exit 2', async () => {
  const { io } = capture();
  assert.equal(await cli(['report'], io), 2);
  assert.equal(await cli(['verify'], io), 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/cli.test.js`
Expected: FAIL — `Cannot find module '../setup.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/project-setup/scripts/setup.mjs
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const USAGE = `project-setup engine

Usage: node setup.mjs <command> [options]

Commands:
  detect                 Print project-state JSON. No mutation.
  plan   --config <f>    Print the ordered action plan. No mutation.
  apply  --config <f>    Execute the plan idempotently. --dry-run to preview.
  report                 Write the quality report. (Plan 3)
  verify                 Run the enabled gates once. (Plan 3)

Options:
  --config <file>        JSON options (answers).
  --dry-run              Plan only; never mutate.
  --backup-dir <dir>     Override backup location (default .project-setup-backup).
  -h, --help             Show this help.
`;

export function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.flags.help = true;
    else if (a === '--dry-run') args.flags.dryRun = true;
    else if (a === '--config') args.flags.config = argv[++i];
    else if (a === '--backup-dir') args.flags.backupDir = argv[++i];
    else if (a.startsWith('--')) args.flags[a.slice(2)] = true;
    else args._.push(a);
  }
  return args;
}

export async function cli(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const err = io.stderr ?? ((s) => process.stderr.write(s));
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (args.flags.help || !cmd) {
    out(USAGE);
    return 0;
  }

  switch (cmd) {
    case 'detect':
    case 'plan':
    case 'apply':
      // Wired to the lib modules in Task 6.
      err(`'${cmd}' is not wired yet.\n`);
      return 2;
    case 'report':
    case 'verify':
      err(`'${cmd}' is not implemented yet (Plan 3).\n`);
      return 2;
    default:
      err(`Unknown command: ${cmd}\n${USAGE}`);
      return 2;
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  cli(process.argv.slice(2)).then((code) => process.exit(code));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/cli.test.js`
Expected: PASS (4 tests). Note: the `apply`/`plan`/`detect` cases are not asserted here yet; `report`/`verify` assert exit 2.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/project-setup/scripts/setup.mjs .claude/skills/project-setup/scripts/tests/cli.test.js
git commit -m "feat(project-setup): engine CLI skeleton with arg parsing and dispatch"
```

---

### Task 2: `detect` — read current project state

**Files:**
- Create: `.claude/skills/project-setup/scripts/lib/detect.mjs`
- Create: `.claude/skills/project-setup/scripts/tests/helpers.js`
- Test: `.claude/skills/project-setup/scripts/tests/detect.test.js`

- [ ] **Step 1: Write the shared temp-project helper**

```js
// .claude/skills/project-setup/scripts/tests/helpers.js
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Create an isolated temp project dir. Returns { dir, write, cleanup }.
export function tmpProject(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'project-setup-'));
  const write = (rel, content) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return abs;
  };
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  return { dir, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
```

- [ ] **Step 2: Write the failing test**

```js
// .claude/skills/project-setup/scripts/tests/detect.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detect, detectEntry, detectGithubRemote, detectPackageManager } from '../lib/detect.mjs';
import { tmpProject } from './helpers.js';

test('detectPackageManager reads the lockfile, defaults to npm', () => {
  const a = tmpProject({ 'pnpm-lock.yaml': '' });
  const b = tmpProject({});
  try {
    assert.equal(detectPackageManager(a.dir), 'pnpm');
    assert.equal(detectPackageManager(b.dir), 'npm');
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('detect reports tooling presence from package.json', () => {
  const p = tmpProject({
    'package.json': { devDependencies: { eslint: '^9', vitest: '^2', typescript: '^5' } },
    'tsconfig.json': '{}',
  });
  try {
    const state = detect(p.dir);
    assert.equal(state.eslint, true);
    assert.equal(state.fallow, false);
    assert.equal(state.testFramework, 'vitest');
    assert.equal(state.typescript, true);
  } finally {
    p.cleanup();
  }
});

test('detectPackageManager returns bun for a bun.lock file (v1.2+ text lockfile)', () => {
  const p = tmpProject({ 'bun.lock': '' });
  try {
    assert.equal(detectPackageManager(p.dir), 'bun');
  } finally {
    p.cleanup();
  }
});

test('detectPackageManager honors package.json#packageManager before the npm fallback', () => {
  const p = tmpProject({ 'package.json': { packageManager: 'pnpm@9.1.0' } }); // no lockfile yet
  try {
    assert.equal(detectPackageManager(p.dir), 'pnpm');
  } finally {
    p.cleanup();
  }
});

test('detectGithubRemote is true only when a github remote exists', () => {
  const gh = tmpProject({ '.git/config': '[remote "origin"]\n  url = https://github.com/o/r.git\n' });
  const gl = tmpProject({ '.git/config': '[remote "origin"]\n  url = https://gitlab.com/o/r.git\n' });
  try {
    assert.equal(detectGithubRemote(gh.dir), true);
    assert.equal(detectGithubRemote(gl.dir), false);
  } finally {
    gh.cleanup();
    gl.cleanup();
  }
});

test('detectEntry returns src/main.ts when it exists, falling back to src/index.ts', () => {
  const withMain = tmpProject({ 'src/main.ts': '' });
  const empty = tmpProject({});
  try {
    assert.equal(detectEntry(withMain.dir), 'src/main.ts');
    assert.equal(detectEntry(empty.dir), 'src/index.ts');
  } finally {
    withMain.cleanup();
    empty.cleanup();
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/tests/detect.test.js`
Expected: FAIL — `Cannot find module '../lib/detect.mjs'`.

- [ ] **Step 4: Write minimal implementation**

```js
// .claude/skills/project-setup/scripts/lib/detect.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENTRY_CANDIDATES = [
  'src/index.ts', 'src/index.tsx', 'src/main.ts', 'src/main.tsx',
  'src/app.ts', 'src/index.js', 'src/main.js', 'index.ts', 'index.js',
];

export function detectEntry(cwd) {
  // A bundler `source` field wins; else the first existing common source entry; else the fallback.
  const src = readJsonSafe(join(cwd, 'package.json'))?.source;
  if (typeof src === 'string' && existsSync(join(cwd, src))) return src;
  for (const c of ENTRY_CANDIDATES) if (existsSync(join(cwd, c))) return c;
  return 'src/index.ts';
}

const PM_LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],   // Bun v1.2+ text lockfile (current default)
  ['bun.lockb', 'bun'],  // legacy binary lockfile
  ['package-lock.json', 'npm'],
];

const PM_NAMES = new Set(['npm', 'pnpm', 'yarn', 'bun']);

export function detectPackageManager(cwd) {
  // 1. Explicit corepack field, e.g. "packageManager": "pnpm@9.1.0" — wins even
  //    before a lockfile exists, so a first apply targets the right manager.
  const declared = readJsonSafe(join(cwd, 'package.json'))?.packageManager;
  if (typeof declared === 'string') {
    const name = declared.split('@')[0];
    if (PM_NAMES.has(name)) return name;
  }
  // 2. Lockfile.
  for (const [file, pm] of PM_LOCKFILES) {
    if (existsSync(join(cwd, file))) return pm;
  }
  // 3. Default.
  return 'npm';
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function detectGithubRemote(cwd) {
  // Ask git first — robust for worktrees/submodules where `.git` is a FILE
  // pointing at the real gitdir (so `.git/config` doesn't exist here).
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (url) return /github\.com/.test(url);
  } catch {
    // git missing or not a repo — fall through to the on-disk config.
  }
  const cfg = join(cwd, '.git', 'config');
  if (!existsSync(cfg)) return false;
  return /github\.com/.test(readFileSync(cfg, 'utf8'));
}

export function detect(cwd) {
  const pkg = readJsonSafe(join(cwd, 'package.json')) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
  return {
    packageManager: detectPackageManager(cwd),
    typescript: has('typescript') || existsSync(join(cwd, 'tsconfig.json')),
    eslint: has('eslint'),
    fallow: has('fallow'),
    testFramework: has('vitest') ? 'vitest' : has('jest') ? 'jest' : null,
    git: existsSync(join(cwd, '.git')),
    github: detectGithubRemote(cwd),
    entry: detectEntry(cwd),
    docs: {
      context: existsSync(join(cwd, 'CONTEXT.md')),
      dir: existsSync(join(cwd, 'docs')),
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/tests/detect.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/project-setup/scripts/lib/detect.mjs .claude/skills/project-setup/scripts/tests/helpers.js .claude/skills/project-setup/scripts/tests/detect.test.js
git commit -m "feat(project-setup): detect project state (package manager, tooling, github)"
```

---

### Task 3: `merge` — additive, non-destructive file merging + backups

**Files:**
- Create: `.claude/skills/project-setup/scripts/lib/merge.mjs`
- Test: `.claude/skills/project-setup/scripts/tests/merge.test.js`

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/project-setup/scripts/tests/merge.test.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { backupFile, deepMerge, mergeJsonFile, mergeTextLines } from '../lib/merge.mjs';
import { tmpProject } from './helpers.js';

test('deepMerge keeps existing scalars, adds missing keys, unions arrays', () => {
  const base = { scripts: { lint: 'mine' }, keywords: ['a'] };
  const patch = { scripts: { lint: 'theirs', test: 'jest' }, keywords: ['a', 'b'] };
  assert.deepEqual(deepMerge(base, patch), {
    scripts: { lint: 'mine', test: 'jest' }, // existing 'lint' preserved
    keywords: ['a', 'b'],
  });
});

test('mergeJsonFile is idempotent', () => {
  const p = tmpProject({ 'package.json': { name: 'x', scripts: { build: 'tsc' } } });
  try {
    const path = join(p.dir, 'package.json');
    const first = mergeJsonFile(path, { scripts: { lint: 'eslint .' } });
    assert.equal(first.changed, true);
    // Apply the result, then merge the same patch again -> no change.
    const second = mergeJsonFile(path, { scripts: { build: 'tsc' } }, first.merged);
    assert.equal(second.changed, false);
  } finally {
    p.cleanup();
  }
});

test('mergeTextLines appends only missing lines', () => {
  const existing = 'node_modules/\ncoverage/\n';
  const r1 = mergeTextLines(existing, ['coverage/', '.fallow/'], 'project-setup');
  assert.match(r1.text, /\.fallow\//);
  assert.equal((r1.text.match(/coverage\//g) ?? []).length, 1); // not duplicated
  const r2 = mergeTextLines(r1.text, ['.fallow/'], 'project-setup');
  assert.equal(r2.changed, false);
});

test('backupFile copies an existing file into the backup dir', () => {
  const p = tmpProject({ 'eslint.config.mjs': 'export default []' });
  try {
    const dest = backupFile(join(p.dir, 'eslint.config.mjs'), join(p.dir, '.bak'));
    assert.ok(existsSync(dest));
    assert.equal(readFileSync(dest, 'utf8'), 'export default []');
    assert.equal(backupFile(join(p.dir, 'missing.txt'), join(p.dir, '.bak')), null);
  } finally {
    p.cleanup();
  }
});

test('backupFile with cwd path-preserves so same-basename files in different dirs never collide', () => {
  const p = tmpProject({
    'a/config.json': '{"src":"a"}',
    'b/config.json': '{"src":"b"}',
  });
  try {
    const bak = join(p.dir, '.bak');
    const destA = backupFile(join(p.dir, 'a/config.json'), bak, p.dir);
    const destB = backupFile(join(p.dir, 'b/config.json'), bak, p.dir);
    assert.notEqual(destA, destB);
    assert.ok(existsSync(destA));
    assert.ok(existsSync(destB));
    assert.equal(readFileSync(destA, 'utf8'), '{"src":"a"}');
    assert.equal(readFileSync(destB, 'utf8'), '{"src":"b"}');
  } finally {
    p.cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/merge.test.js`
Expected: FAIL — `Cannot find module '../lib/merge.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/project-setup/scripts/lib/merge.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Additive merge: existing values win on conflict; missing keys are filled;
// arrays union (dedup by structural equality). To REPLACE a value, use a
// backup-overwrite write instead — merge never clobbers user data.
export function deepMerge(base, patch) {
  if (isObject(base) && isObject(patch)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
  }
  if (Array.isArray(base) && Array.isArray(patch)) {
    const out = [...base];
    for (const item of patch) {
      if (!out.some((x) => JSON.stringify(x) === JSON.stringify(item))) out.push(item);
    }
    return out;
  }
  return base === undefined ? patch : base;
}

// `current` is optional, for tests that pass an in-memory object instead of reading disk.
export function mergeJsonFile(path, patch, current) {
  const base = current ?? (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
  const merged = deepMerge(base, patch);
  const changed = JSON.stringify(base) !== JSON.stringify(merged);
  return { merged, changed, text: JSON.stringify(merged, null, 2) + '\n' };
}

export function mergeTextLines(existing, lines, marker) {
  const present = new Set(existing.split('\n').map((l) => l.trim()));
  const additions = lines.filter((l) => !present.has(l.trim()));
  if (additions.length === 0) return { text: existing, changed: false };
  const block = (marker ? [`# ${marker}`] : []).concat(additions).join('\n');
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  return { text: `${existing}${sep}${block}\n`, changed: true };
}

export function backupFile(absPath, backupDir, cwd) {
  if (!existsSync(absPath)) return null;
  // Path-preserve under backupDir (mirror the file's location relative to cwd)
  // so two files with the same basename never collide; fall back to basename
  // when cwd is not provided.
  const sub = cwd ? relative(cwd, absPath) : basename(absPath);
  const dest = join(backupDir, sub);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(absPath, dest);
  return dest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/merge.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/project-setup/scripts/lib/merge.mjs .claude/skills/project-setup/scripts/tests/merge.test.js
git commit -m "feat(project-setup): additive non-destructive merge helpers + backups"
```

---

### Task 4: `plan` — options + state into an ordered `Action[]`

**Files:**
- Create: `.claude/skills/project-setup/scripts/lib/plan.mjs`
- Test: `.claude/skills/project-setup/scripts/tests/plan.test.js`

The `Action` shapes (the contract Plans 2–3 extend):
- `{ type: 'mergeText', path, lines: string[], marker }`
- `{ type: 'mergeJson', path, patch }`
- `{ type: 'writeFile', path, content, mode: 'skip-if-exists' | 'overwrite-backup' }`

`plan()` concatenates pure sub-planners so each new concern is one function. Plan 1 ships `planGitignore` (ensure the engine's own artifacts are ignored) and `planRunReport` (record the run).

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/project-setup/scripts/tests/plan.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plan } from '../lib/plan.mjs';

const options = { guardrails: {}, github: { integrate: false }, docs: {} };
const state = { packageManager: 'npm', github: false };

test('plan returns an ordered array of known action types', () => {
  const actions = plan(options, state);
  assert.ok(Array.isArray(actions) && actions.length >= 2);
  for (const a of actions) {
    assert.ok(['mergeText', 'mergeJson', 'writeFile'].includes(a.type));
  }
});

test('plan ignores the engine artifacts in .gitignore', () => {
  const actions = plan(options, state);
  const gi = actions.find((a) => a.type === 'mergeText' && a.path === '.gitignore');
  assert.ok(gi, 'expected a .gitignore mergeText action');
  assert.ok(gi.lines.includes('.project-setup-backup/'));
  assert.ok(gi.lines.includes('.fallow/'));
});

test('plan writes a run report (overwrite-backup mode)', () => {
  const actions = plan(options, state);
  const report = actions.find((a) => a.path === 'project-setup.report.json');
  assert.ok(report);
  assert.equal(report.type, 'writeFile');
  assert.equal(report.mode, 'overwrite-backup');
  assert.match(report.content, /"engine"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/plan.test.js`
Expected: FAIL — `Cannot find module '../lib/plan.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/project-setup/scripts/lib/plan.mjs

const ENGINE_VERSION = '0.1.0';

function planGitignore() {
  return [
    {
      type: 'mergeText',
      path: '.gitignore',
      marker: 'project-setup',
      lines: ['.project-setup-backup/', '.fallow/', 'coverage/'],
    },
  ];
}

function planRunReport(options, state) {
  // Deterministic: NO timestamp. The report content must be a pure function of
  // options + state so a re-apply produces identical content and the writeFile
  // idempotency check (content-equal -> skip) holds. Run timing, if ever
  // needed, must live outside this idempotent plan artifact.
  const report = {
    engine: ENGINE_VERSION,
    options,
    detected: state,
  };
  return [
    {
      type: 'writeFile',
      path: 'project-setup.report.json',
      mode: 'overwrite-backup',
      content: JSON.stringify(report, null, 2) + '\n',
    },
  ];
}

// Ordered composition of pure sub-planners. Plans 2-3 add planHarness,
// planBaseline, planDocs, planGithub here.
export function plan(options, state) {
  return [...planGitignore(options, state), ...planRunReport(options, state)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/plan.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/project-setup/scripts/lib/plan.mjs .claude/skills/project-setup/scripts/tests/plan.test.js
git commit -m "feat(project-setup): plan options+state into an ordered Action[]"
```

---

### Task 5: `apply` — execute the plan idempotently, with dry-run and backups

**Files:**
- Create: `.claude/skills/project-setup/scripts/lib/apply.mjs`
- Test: `.claude/skills/project-setup/scripts/tests/apply.test.js`

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/project-setup/scripts/tests/apply.test.js
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { apply } from '../lib/apply.mjs';
import { tmpProject } from './helpers.js';

const actions = [
  { type: 'mergeText', path: '.gitignore', marker: 'project-setup', lines: ['.fallow/'] },
  { type: 'mergeJson', path: 'package.json', patch: { scripts: { report: 'node x.mjs' } } },
  { type: 'writeFile', path: 'project-setup.report.json', mode: 'overwrite-backup', content: '{"v":1}\n' },
];

test('apply writes/merges all actions on a fresh project', () => {
  const p = tmpProject({ 'package.json': { name: 'x' }, '.gitignore': 'node_modules/\n' });
  try {
    const res = apply(actions, { cwd: p.dir });
    assert.match(readFileSync(join(p.dir, '.gitignore'), 'utf8'), /\.fallow\//);
    assert.equal(JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')).scripts.report, 'node x.mjs');
    assert.ok(existsSync(join(p.dir, 'project-setup.report.json')));
    assert.ok(res.changed.length >= 3);
  } finally {
    p.cleanup();
  }
});

test('apply is idempotent: a second run changes nothing', () => {
  const p = tmpProject({ 'package.json': { name: 'x' }, '.gitignore': 'node_modules/\n' });
  try {
    apply(actions, { cwd: p.dir });
    const second = apply(actions, { cwd: p.dir });
    // mergeText/mergeJson are no-ops; the report is identical content so unchanged too.
    assert.deepEqual(second.changed, []);
  } finally {
    p.cleanup();
  }
});

test('dry-run mutates nothing but reports the plan', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  try {
    const res = apply(actions, { cwd: p.dir, dryRun: true });
    assert.equal(existsSync(join(p.dir, 'project-setup.report.json')), false);
    assert.ok(res.planned.length >= 3);
  } finally {
    p.cleanup();
  }
});

test('overwrite-backup backs up an existing file before replacing it', () => {
  const p = tmpProject({ 'project-setup.report.json': '{"old":true}\n', 'package.json': { name: 'x' } });
  try {
    apply(actions, { cwd: p.dir, backupDir: join(p.dir, '.bak') });
    assert.equal(readFileSync(join(p.dir, 'project-setup.report.json'), 'utf8'), '{"v":1}\n');
    const backups = readdirSync(join(p.dir, '.bak'));
    assert.ok(backups.includes('project-setup.report.json'));
  } finally {
    p.cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/apply.test.js`
Expected: FAIL — `Cannot find module '../lib/apply.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/project-setup/scripts/lib/apply.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { backupFile, mergeJsonFile, mergeTextLines } from './merge.mjs';

export function apply(actions, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const dryRun = opts.dryRun ?? false;
  const backupDir = opts.backupDir ?? join(cwd, '.project-setup-backup', String(Date.now()));
  const changed = [];
  const planned = [];

  for (const action of actions) {
    const abs = join(cwd, action.path);
    planned.push(action.path); // every action is part of the plan

    if (action.type === 'mergeText') {
      const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
      const { text, changed: didChange } = mergeTextLines(existing, action.lines, action.marker);
      if (didChange && !dryRun) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text);
      }
      if (didChange) changed.push(action.path);
    } else if (action.type === 'mergeJson') {
      const { text, changed: didChange } = mergeJsonFile(abs, action.patch);
      if (didChange && !dryRun) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text);
      }
      if (didChange) changed.push(action.path);
    } else if (action.type === 'writeFile') {
      const exists = existsSync(abs);
      if (action.mode === 'skip-if-exists' && exists) continue;
      if (exists && readFileSync(abs, 'utf8') === action.content) continue; // idempotent
      if (action.mode === 'overwrite-backup' && exists && !dryRun) backupFile(abs, backupDir, cwd);
      if (!dryRun) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, action.content);
      }
      changed.push(action.path);
    } else {
      throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  return { changed, planned, dryRun };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/apply.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/project-setup/scripts/lib/apply.mjs .claude/skills/project-setup/scripts/tests/apply.test.js
git commit -m "feat(project-setup): idempotent apply with dry-run and backups"
```

---

### Task 6: Wire the CLI to the libs + end-to-end integration test

**Files:**
- Modify: `.claude/skills/project-setup/scripts/setup.mjs` (replace the stubbed `detect`/`plan`/`apply` cases)
- Create: `.claude/skills/project-setup/scripts/lib/options.mjs`
- Create: `.claude/skills/project-setup/scripts/tests/integration.test.js`
- Create: `.claude/skills/project-setup/scripts/README.md`

- [ ] **Step 1: Write the failing integration test**

```js
// .claude/skills/project-setup/scripts/tests/integration.test.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { cli } from '../setup.mjs';
import { tmpProject } from './helpers.js';

function capture(cwd) {
  const chunks = { out: '', err: '' };
  return { io: { stdout: (s) => (chunks.out += s), stderr: (s) => (chunks.err += s), cwd }, chunks };
}

test('detect prints state JSON for the cwd', async () => {
  const p = tmpProject({ 'package.json': { devDependencies: { jest: '^30' } } });
  try {
    const { io, chunks } = capture(p.dir);
    const code = await cli(['detect'], io);
    assert.equal(code, 0);
    assert.equal(JSON.parse(chunks.out).testFramework, 'jest');
  } finally {
    p.cleanup();
  }
});

test('apply --config creates engine artifacts; second run is idempotent', async () => {
  const p = tmpProject({ 'package.json': { name: 'x' }, '.gitignore': 'node_modules/\n' });
  try {
    const cfg = join(p.dir, 'answers.json');
    writeFileSync(cfg, JSON.stringify({ guardrails: {}, github: { integrate: false }, docs: {} }));

    const first = capture(p.dir);
    assert.equal(await cli(['apply', '--config', cfg], first.io), 0);
    assert.ok(existsSync(join(p.dir, 'project-setup.report.json')));
    assert.match(readFileSync(join(p.dir, '.gitignore'), 'utf8'), /\.project-setup-backup\//);
    assert.match(first.chunks.out, /Applied/);

    const second = capture(p.dir);
    assert.equal(await cli(['apply', '--config', cfg], second.io), 0);
    assert.match(second.chunks.out, /No changes/);
  } finally {
    p.cleanup();
  }
});

test('plan --config --dry-run prints actions and mutates nothing', async () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  try {
    const cfg = join(p.dir, 'answers.json');
    writeFileSync(cfg, JSON.stringify({ guardrails: {}, github: { integrate: false }, docs: {} }));
    const { io, chunks } = capture(p.dir);
    assert.equal(await cli(['plan', '--config', cfg], io), 0);
    assert.equal(existsSync(join(p.dir, 'project-setup.report.json')), false);
    assert.match(chunks.out, /project-setup\.report\.json/);
  } finally {
    p.cleanup();
  }
});

test('apply without --config exits 2', async () => {
  const p = tmpProject({});
  try {
    const { io, chunks } = capture(p.dir);
    assert.equal(await cli(['apply'], io), 2);
    assert.match(chunks.err, /--config is required/);
  } finally {
    p.cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/integration.test.js`
Expected: FAIL — `detect`/`apply` still print "not wired" and exit 2.

- [ ] **Step 3: Write the options loader**

```js
// .claude/skills/project-setup/scripts/lib/options.mjs
import { readFileSync } from 'node:fs';

const DEFAULTS = {
  packageManager: null, // null => use detected
  typescript: true,
  testFramework: null, // null => use detected
  guardrails: { fallowRatchet: true, locGuard: true, eslintSeverityStaging: true, coverageFloors: true, ci: true },
  github: { integrate: false, mcp: false, fixApply: false },
  docs: { scaffold: true, grill: false },
  locCap: 500,
};

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function mergeDefaults(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    out[k] = isObject(base[k]) && isObject(v) ? mergeDefaults(base[k], v) : v;
  }
  return out;
}

export function loadOptions(configPath) {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  return mergeDefaults(DEFAULTS, raw);
}
```

- [ ] **Step 4: Wire the CLI commands**

Replace the `case 'detect': case 'plan': case 'apply':` block in `setup.mjs` with real handlers. Add these imports at the top of `setup.mjs`:

```js
import { apply } from './lib/apply.mjs';
import { detect } from './lib/detect.mjs';
import { loadOptions } from './lib/options.mjs';
import { plan } from './lib/plan.mjs';
```

Replace the dispatch `switch` body for those three cases with:

```js
    case 'detect': {
      out(JSON.stringify(detect(io.cwd ?? process.cwd()), null, 2) + '\n');
      return 0;
    }
    case 'plan':
    case 'apply': {
      const cwd = io.cwd ?? process.cwd();
      if (!args.flags.config) {
        err('--config is required for plan/apply.\n');
        return 2;
      }
      const options = loadOptions(resolve(cwd, args.flags.config));
      const actions = plan(options, detect(cwd));
      const dryRun = cmd === 'plan' || args.flags.dryRun === true;
      const backupDir = args.flags.backupDir ? resolve(cwd, args.flags.backupDir) : undefined;
      const result = apply(actions, { cwd, dryRun, backupDir });
      if (dryRun) {
        out(`Planned ${result.planned.length} action(s):\n` + result.planned.map((p) => `  ${p}`).join('\n') + '\n');
      } else if (result.changed.length === 0) {
        out('No changes — project already converged.\n');
      } else {
        out(`Applied ${result.changed.length} change(s):\n` + result.changed.map((p) => `  ${p}`).join('\n') + '\n');
      }
      return 0;
    }
```

- [ ] **Step 5: Write the scripts README**

```markdown
<!-- .claude/skills/project-setup/scripts/README.md -->
# project-setup engine

Deterministic setup engine. Node ≥18, zero runtime deps.

## Commands

    node setup.mjs detect                 # print project-state JSON
    node setup.mjs plan  --config a.json  # print the action plan (no mutation)
    node setup.mjs apply --config a.json  # apply idempotently (--dry-run to preview)

`report` and `verify` arrive in Plan 3.

## Tests

    node --test scripts/tests/*.test.js

All tests are `node:test` specs operating on temp-dir fixtures — no network,
no global state.
```

- [ ] **Step 6: Run the full suite to verify it passes**

Run: `node --test scripts/tests/*.test.js`
Expected: PASS (all specs across cli, detect, merge, plan, apply, integration).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/project-setup/scripts/setup.mjs .claude/skills/project-setup/scripts/lib/options.mjs .claude/skills/project-setup/scripts/tests/integration.test.js .claude/skills/project-setup/scripts/README.md
git commit -m "feat(project-setup): wire CLI to detect/plan/apply with options loader"
```

---

## Self-review (against the spec, engine-core scope)

- **Determinism model (spec §"Determinism and safety model"):** detect→plan→apply ✓ (Tasks 2/4/5/6); idempotent re-run ✓ (Task 5/6 tests); non-destructive merge + backup ✓ (Tasks 3/5); dry-run ✓ (Tasks 5/6); explicit `--config` intent ✓ (Task 6). Run report (`project-setup.report.json`) ✓ (Task 4). *Pinned versions / dirty-tree warning* are deferred — versions belong to Plan 2 (dep install), the dirty-tree warning to the SKILL.md orchestration in Plan 3; noted here so they are not lost.
- **Engine CLI contract (spec):** `detect | plan | apply` implemented; `report | verify` correctly stubbed to exit 2 with a "Plan 3" message ✓.
- **Action contract:** `mergeText` / `mergeJson` / `writeFile{create,skip-if-exists,overwrite-backup}` defined in Task 4, consumed unchanged in Task 5 — names match across tasks ✓.
- **Portability (spec):** only `node:*` built-ins used across all modules ✓.
- **Placeholder scan:** every step has runnable code and an exact command. The one risk flagged inline (the unused `writeIfChanged` helper in Task 5) carries an explicit "remove it" correction so it can't ship.
- **Out of engine-core scope (correctly deferred to Plans 2–3):** templates, dep install, baselines, coverage, docs scaffold, report/verify bodies, SKILL.md, GitHub. These are listed in the decomposition header so the roadmap is explicit.
