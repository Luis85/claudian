#!/usr/bin/env node
/**
 * Artifact smoke check: prove a production build is shippable.
 *
 * Why this exists: `npm run build` produces the release bundle (main.js,
 * styles.css) and the manifest that Obsidian loads, but nothing verified the
 * outputs were present, version-synced, and within a sane size budget. An
 * agent could leave artifacts stale, desync package.json/manifest.json, or
 * balloon the bundle and CI would stay green
 * (docs/tech-debt/2026-06-07-agentic-quality-gates.md).
 *
 * This is a post-build gate: run `npm run build` first (CI does), then this.
 * It does NOT build — keeping it cheap to run repeatedly and easy to reason
 * about in isolation.
 *
 * Checks:
 *   1. main.js, styles.css, manifest.json all exist and are non-empty.
 *   2. package.json version === manifest.json version (release sync).
 *   3. manifest.minAppVersion is present and recorded in versions.json for the
 *      current version.
 *   4. main.js and styles.css stay within the byte budget below. Budgets have
 *      headroom to absorb normal growth but catch an accidental doubling.
 *
 * Bump a budget deliberately (with a reason in the PR) when a real dependency
 * pushes the bundle up — do not silently raise it to make CI pass.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const MB = 1024 * 1024;
const KB = 1024;

// Measured 2026-06-07: main.js ~2.88 MB (SDK-dominated), styles.css ~145 KB.
const BUDGET = {
  'main.js': Math.round(3.6 * MB),
  'styles.css': Math.round(256 * KB),
};

const errors = [];

function readJson(file) {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
}

function formatBytes(bytes) {
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
  return `${(bytes / KB).toFixed(1)} KB`;
}

// 1 + 4: presence + size budget.
for (const [file, maxBytes] of Object.entries(BUDGET)) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) {
    errors.push(`Missing build artifact: ${file} (run \`npm run build\`).`);
    continue;
  }
  const { size } = statSync(abs);
  if (size === 0) {
    errors.push(`Empty build artifact: ${file}.`);
  } else if (size > maxBytes) {
    errors.push(
      `${file} is ${formatBytes(size)}, over the ${formatBytes(maxBytes)} ` +
        `budget. Trim it, or raise the budget in scripts/check-artifacts.mjs ` +
        `with a reason.`,
    );
  }
}

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');

if (!existsSync(join(ROOT, 'manifest.json'))) {
  errors.push('Missing manifest.json.');
}

// 2: release version sync.
if (manifest.version !== pkg.version) {
  errors.push(
    `Version desync: package.json is ${pkg.version} but manifest.json is ` +
      `${manifest.version}. Run \`npm run version\`.`,
  );
}

// 3: minAppVersion present and recorded.
if (!manifest.minAppVersion) {
  errors.push('manifest.json is missing minAppVersion.');
} else {
  const versions = readJson('versions.json');
  if (versions[manifest.version] === undefined) {
    errors.push(
      `versions.json has no entry for ${manifest.version}. The release flow ` +
        `should map it to a minAppVersion (expected ${manifest.minAppVersion}).`,
    );
  } else if (versions[manifest.version] !== manifest.minAppVersion) {
    errors.push(
      `minAppVersion mismatch for ${manifest.version}: manifest says ` +
        `${manifest.minAppVersion}, versions.json says ` +
        `${versions[manifest.version]}.`,
    );
  }
}

if (errors.length > 0) {
  console.error('Artifact check FAILED:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const sizes = Object.keys(BUDGET)
  .map((f) => `${f} ${formatBytes(statSync(join(ROOT, f)).size)}`)
  .join(', ');
console.log(`Artifact check OK: ${sizes}; version ${manifest.version}.`);
