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
