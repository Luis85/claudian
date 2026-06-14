// scripts/lib/baseline.mjs
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { applyCoverageFloor } from './coverage.mjs';
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
    const r = applyCoverageFloor(cwd, options.testFramework ?? 'jest'); // floor = current (rise-only)
    if (!r.updated && r.reason === 'user config') {
      // Brownfield with a hand-written test config: we do NOT rewrite it
      // (non-destructive), so we cannot guarantee a safe day-one floor. Warn
      // loudly rather than silently shipping a config that may over-enforce.
      console.warn(
        '[project-setup] Existing test config detected — coverage floor NOT set. ' +
          'Your config owns its thresholds; set them to current coverage (or drop ' +
          'the coverage gate) so CI stays green on day one.',
      );
    }
  }
}
