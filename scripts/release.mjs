#!/usr/bin/env node
/**
 * Self-contained release script.
 *
 * Does the whole release locally so it does not depend on GitHub Actions
 * (disabled on this fork) or on the `gh` default repo (which resolves to the
 * upstream parent). Always targets RELEASE_REPO explicitly.
 *
 * Usage:
 *   node scripts/release.mjs <version|patch|minor|major> [--dry-run] [--skip-tests] [--allow-non-main]
 *   npm run release -- 2.5.1
 *   npm run release -- minor
 *
 * Releases must be cut from `main` so the version files committed by this
 * script and the GitHub release artifacts never disagree. Pass
 * --allow-non-main only when an off-main release is genuinely intended.
 *
 * Steps: validate -> bump (package.json + manifest.json + versions.json)
 *        -> typecheck -> test -> build -> commit -> tag -> push -> gh release.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RELEASE_REPO = 'Luis85/claudian';
const ASSETS = ['main.js', 'manifest.json', 'styles.css'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipTests = args.includes('--skip-tests');
const allowNonMain = args.includes('--allow-non-main');
const versionArg = args.find((a) => !a.startsWith('--'));

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function run(command, { capture = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${command}`);
    return '';
  }
  return execSync(command, {
    cwd: ROOT,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(join(ROOT, file), JSON.stringify(value, null, 2) + '\n');
}

function bumpSemver(current, kind) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

if (!versionArg) {
  fail('Provide a version (x.y.z) or a bump kind (patch|minor|major).');
}

const pkg = readJson('package.json');
const nextVersion = ['patch', 'minor', 'major'].includes(versionArg)
  ? bumpSemver(pkg.version, versionArg)
  : versionArg;

if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) {
  fail(`Invalid version "${nextVersion}". Expected x.y.z.`);
}

// Guard: clean working tree.
const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' });
if (status.trim()) {
  fail('Working tree is not clean. Commit or stash changes before releasing.');
}

// Guard: tag must not already exist.
const existingTags = execSync('git tag', { cwd: ROOT, encoding: 'utf8' }).split('\n');
if (existingTags.includes(nextVersion)) {
  fail(`Tag ${nextVersion} already exists.`);
}

// Guard: only main may cut a release. A previous 3.0.0 cut from a feature
// branch left main's version files trailing the GitHub release artifacts,
// so test builds from main showed the prior version. Hard-fail by default;
// pass --allow-non-main when an off-main release is genuinely intended.
const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
if (branch !== 'main') {
  if (!allowNonMain) {
    fail(`Refusing to release from "${branch}". Switch to main, or pass --allow-non-main to override.`);
  }
  console.warn(`⚠ Releasing from "${branch}", not main (--allow-non-main).`);
}

console.log(`Releasing ${pkg.version} → ${nextVersion} on ${RELEASE_REPO}${dryRun ? ' (dry-run)' : ''}`);

// 1. Bump versions.
if (!dryRun) {
  pkg.version = nextVersion;
  writeJson('package.json', pkg);

  const manifest = readJson('manifest.json');
  const minAppVersion = manifest.minAppVersion;
  manifest.version = nextVersion;
  writeJson('manifest.json', manifest);

  const versions = readJson('versions.json');
  versions[nextVersion] = minAppVersion;
  writeJson('versions.json', versions);
  console.log(`✓ Bumped package.json, manifest.json, versions.json (minApp ${minAppVersion})`);
} else {
  console.log('[dry-run] would bump package.json, manifest.json, versions.json');
}

// 2. Verify.
run('npm run typecheck');
if (!skipTests) {
  run('npm test');
} else {
  console.warn('⚠ Skipping tests (--skip-tests).');
}
run('node scripts/build.mjs production');

for (const asset of ASSETS) {
  if (!dryRun && !existsSync(join(ROOT, asset))) {
    fail(`Build artifact missing: ${asset}`);
  }
}

// 3. Commit, tag, push.
run(`git add package.json manifest.json versions.json`);
run(`git commit -m "chore(release): ${nextVersion}"`);
run(`git tag -a ${nextVersion} -m "Release ${nextVersion}"`);
run(`git push origin ${branch}`);
run(`git push origin ${nextVersion}`);

// 4. GitHub release with assets (explicit repo, never the fork parent).
run(`gh release create ${nextVersion} ${ASSETS.join(' ')} --repo ${RELEASE_REPO} --title ${nextVersion} --generate-notes`);

console.log(`✓ Released ${nextVersion}: https://github.com/${RELEASE_REPO}/releases/tag/${nextVersion}`);
