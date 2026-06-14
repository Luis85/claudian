// scripts/lib/coverage.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MARKER } from './marker.mjs';

const CONFIG = { jest: 'jest.config.mjs', vitest: 'vitest.config.mjs' };
// Match ONLY the threshold object (a flat {statements,branches,functions,lines}),
// so we can update it in place without touching anything else in the config.
const ANCHOR = {
  jest: /coverageThreshold:\s*\{\s*global:\s*\{[^}]*\}\s*\}/,
  vitest: /thresholds:\s*\{[^}]*\}/,
};

// True once the floor has been set (a non-zero threshold), or the config is the
// user's own. A later apply must NOT re-measure coverage and silently lower the
// threshold to a regressed value.
export function isCoverageBaselined(cwd, framework) {
  const configPath = join(cwd, CONFIG[framework]);
  if (!existsSync(configPath)) return false; // no config yet -> not baselined
  const content = readFileSync(configPath, 'utf8');
  if (!content.includes(MARKER)) return true; // user-owned config -> not ours to floor
  const m = content.match(ANCHOR[framework]);
  return m ? /[1-9]/.test(m[0]) : false; // any non-zero threshold digit => floored
}

export function floorThresholds(summary) {
  const t = summary.total;
  const f = (k) => Math.floor(t[k].pct);
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
