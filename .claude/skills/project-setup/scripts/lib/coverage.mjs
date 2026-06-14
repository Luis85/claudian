// scripts/lib/coverage.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { MARKER } from './marker.mjs';

const CONFIG = { jest: 'jest.config.mjs', vitest: 'vitest.config.mjs' };
// Match ONLY the threshold object (a flat {statements,branches,functions,lines}),
// so we can update it in place without touching anything else in the config.
const ANCHOR = {
  jest: /coverageThreshold:\s*\{\s*global:\s*\{[^}]*\}\s*\}/,
  vitest: /thresholds:\s*\{[^}]*\}/,
};
const BASELINE_MARK = join('.project-setup-backup', '.coverage-baselined');

// True once the coverage floor has been baselined. A marker FILE (not the config
// value) tracks this so a legitimately-0% floor is distinguished from the initial
// {0,0,0,0} placeholder — otherwise a converged re-apply would re-measure and could
// silently raise the floor.
export function isCoverageBaselined(cwd) {
  return existsSync(join(cwd, BASELINE_MARK));
}

export function markCoverageBaselined(cwd) {
  const p = join(cwd, BASELINE_MARK);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, '');
}

export function floorThresholds(summary) {
  const t = summary.total;
  // Istanbul reports "Unknown" (a string) for a pct when nothing was collected
  // (fresh repo / globs match no source); coerce to 0 so the config gets a valid
  // numeric floor, not a `null` from Math.floor(NaN).
  const f = (k) => {
    const pct = Number(t[k]?.pct);
    return Number.isFinite(pct) ? Math.floor(pct) : 0;
  };
  return { statements: f('statements'), branches: f('branches'), functions: f('functions'), lines: f('lines') };
}

export function applyCoverageFloor(cwd, framework) {
  const summaryPath = join(cwd, 'coverage', 'coverage-summary.json');
  const configPath = join(cwd, CONFIG[framework]);
  if (!existsSync(summaryPath) || !existsSync(configPath)) return { updated: false, reason: 'no summary/config' };
  const existing = readFileSync(configPath, 'utf8');
  if (!existing.includes(MARKER)) return { updated: false, reason: 'user config' };
  const anchor = ANCHOR[framework];
  if (!anchor.test(existing)) return { updated: false, reason: 'threshold anchor not found' };

  const thresholds = floorThresholds(JSON.parse(readFileSync(summaryPath, 'utf8')));
  const json = JSON.stringify(thresholds);
  // Replace ONLY the threshold object — re-rendering the whole template would
  // silently wipe any setup files / aliases / reporters the user later added to
  // the (still-marked) config. The coverage globs are likewise left untouched.
  const replacement = framework === 'jest' ? `coverageThreshold: { global: ${json} }` : `thresholds: ${json}`;
  const next = existing.replace(anchor, replacement);
  if (next === existing) return { updated: false, reason: 'already at floor' };
  writeFileSync(configPath, next);
  return { updated: true, thresholds };
}
