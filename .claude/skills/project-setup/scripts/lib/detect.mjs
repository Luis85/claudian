// .claude/skills/project-setup/scripts/lib/detect.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PM_LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],   // Bun v1.2+ text lockfile (current default)
  ['bun.lockb', 'bun'],  // legacy binary lockfile
  ['package-lock.json', 'npm'],
];

export function detectPackageManager(cwd) {
  for (const [file, pm] of PM_LOCKFILES) {
    if (existsSync(join(cwd, file))) return pm;
  }
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
    docs: {
      context: existsSync(join(cwd, 'CONTEXT.md')),
      dir: existsSync(join(cwd, 'docs')),
    },
  };
}
