// .claude/skills/project-setup/scripts/lib/detect.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MARKER } from './marker.mjs';

// index/main/app under src/ then root, each in ts/tsx/js/jsx/mjs. Covers JS-only
// apps (e.g. src/app.js, src/app.jsx) — not just the TypeScript variants — so a
// JS entrypoint isn't mis-fallen-back to src/index.ts and flagged unused.
const ENTRY_BASENAMES = ['index', 'main', 'app'];
const ENTRY_EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];
// Common source dirs (src, lib, app, source) + repo root.
const ENTRY_DIRS = ['src', 'lib', 'app', 'source', ''];
const ENTRY_CANDIDATES = ENTRY_DIRS.flatMap((d) =>
  ENTRY_BASENAMES.flatMap((b) => ENTRY_EXTS.map((e) => (d ? `${d}/${b}.${e}` : `${b}.${e}`))),
);
// `main`/`module` often point at BUILD output, not source — skip those roots.
const BUILD_DIRS = new Set(['dist', 'build', 'out', 'esm', 'cjs', 'umd', 'lib-esm', 'node_modules', '.next']);

export function detectEntry(cwd) {
  const pkg = readJsonSafe(join(cwd, 'package.json'));
  // A bundler `source` field is unambiguously the source entry.
  const src = pkg?.source;
  if (typeof src === 'string' && existsSync(join(cwd, src))) return src;
  // The first existing common source entry (src/lib/app/source/root).
  for (const c of ENTRY_CANDIDATES) if (existsSync(join(cwd, c))) return c;
  // `module`/`main` may name the source for a build-less package — use it if it
  // exists and its top dir isn't a build-output dir.
  for (const field of ['module', 'main']) {
    const p = pkg?.[field];
    if (typeof p === 'string' && existsSync(join(cwd, p)) && !BUILD_DIRS.has(p.split('/')[0])) return p;
  }
  return 'src/index.ts';
}

const ESLINTRC = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml'];
// Flat configs in a different extension than the eslint.config.mjs we write —
// ESLint loads only one (it checks .js before .mjs), so either theirs wins (ours
// is ignored) or ours shadows theirs. Both are collisions worth reporting.
const ESLINT_FLAT = ['eslint.config.js', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts'];
// Per-runner config signals — kept SEPARATE so the standdown decision can be
// scoped to the resolved runner (Jest ignores vitest.config, and vice versa).
// Vitest also reads vite.config by default, so a generated vitest.config would
// override the project's plugins/aliases/setup.
const JEST_CONFIGS = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.cts', 'jest.config.mts', 'jest.config.json'];
const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs', 'vitest.config.cts', 'vitest.config.mts'];
const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.cts', 'vite.config.mts'];

function existsAny(cwd, names) {
  return names.some((n) => existsSync(join(cwd, n)));
}

// True when one of `names` exists and the engine did NOT write it (no marker) —
// a hand-written config whose thresholds we can't safely baseline.
function hasUnmarkedConfig(cwd, names) {
  for (const f of names) {
    const p = join(cwd, f);
    if (!existsSync(p)) continue;
    try {
      if (!readFileSync(p, 'utf8').includes(MARKER)) return true;
    } catch {
      return true;
    }
  }
  return false;
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

export function detectDefaultBranch(cwd) {
  // The remote's default branch, so generated CI targets the real trunk instead of
  // a hardcoded `main`. Do NOT fall back to the current branch: running setup from a
  // feature branch would otherwise filter CI to that branch and skip PRs to the real
  // trunk. Default to `main` when origin/HEAD is unknown (the pull_request CI trigger
  // is unfiltered, so PRs still run).
  try {
    const ref = execFileSync('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (ref && ref !== 'origin/HEAD') return ref.replace(/^origin\//, '');
  } catch {
    // no remote HEAD ref — fall through
  }
  return 'main';
}

export function detect(cwd) {
  const pkg = readJsonSafe(join(cwd, 'package.json')) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
  const testFramework = has('vitest') ? 'vitest' : has('jest') ? 'jest' : null;
  return {
    packageManager: detectPackageManager(cwd),
    typescript: has('typescript') || existsSync(join(cwd, 'tsconfig.json')),
    eslint: has('eslint'),
    fallow: has('fallow'),
    testFramework,
    git: existsSync(join(cwd, '.git')),
    github: detectGithubRemote(cwd),
    defaultBranch: detectDefaultBranch(cwd),
    entry: detectEntry(cwd),
    // Brownfield collision signals — planners turn these into user-facing notices
    // instead of silently no-op'ing on a pre-existing config/script/workflow.
    scripts: pkg.scripts ?? {},
    legacyEslintrc: existsAny(cwd, ESLINTRC),
    eslintFlatConfig: existsAny(cwd, ESLINT_FLAT),
    // The same-name config we write (skip-if-exists) — flagged only when it's the
    // user's own (no marker), so a re-apply of our generated one won't false-fire.
    eslintConfigMjs: hasUnmarkedConfig(cwd, ['eslint.config.mjs']),
    ciWorkflow: existsSync(join(cwd, '.github', 'workflows', 'ci.yml')),
    // Jest also reads a `jest` key in package.json — writing jest.config.mjs beside
    // it makes Jest 30 error "Multiple configurations found".
    jestConfig: hasUnmarkedConfig(cwd, JEST_CONFIGS) || pkg.jest != null,
    vitestConfig: hasUnmarkedConfig(cwd, VITEST_CONFIGS),
    viteConfig: existsAny(cwd, VITE_CONFIGS),
    docs: {
      context: existsSync(join(cwd, 'CONTEXT.md')),
      dir: existsSync(join(cwd, 'docs')),
    },
  };
}
