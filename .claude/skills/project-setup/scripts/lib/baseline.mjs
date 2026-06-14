// scripts/lib/baseline.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { applyCoverageFloor, isCoverageBaselined } from './coverage.mjs';
import { runScriptArgs } from './packageManager.mjs';

const defaultExec = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// Snapshot today's debt as the bar — but ONLY for a guardrail that is newly
// added (its baseline artifact is absent). Re-running apply for an unrelated
// change (toggling docs / GitHub) must NOT re-run `--update`: that would reset
// the ratchets to the current, possibly regressed, state and silently bless debt
// accumulated since adoption. Order: fallow + LOC first (coverage absent so CRAP
// stays static_estimated), coverage last (it creates ./coverage).
export function initBaselines(cwd, options, exec = defaultExec) {
  const g = options.guardrails ?? {};
  const pm = options.packageManager ?? 'npm';
  // Run the ratchets through the package manager (not bare `node`), so Yarn PnP's
  // loader is present for check-quality.mjs's require.resolve('fallow/bin/fallow').
  const runScript = (script, extra) => {
    const [cmd, cargs] = runScriptArgs(pm, script, extra);
    exec(cmd, cargs, { cwd });
  };
  // Remove any pre-existing coverage BEFORE the fallow baseline: a stray
  // ./coverage flips fallow CRAP to coverage-weighted, which would bless
  // inflated complexity debt into the baseline (docs/CI require coverage absent).
  rmSync(join(cwd, 'coverage'), { recursive: true, force: true });
  if (g.fallowRatchet && !existsSync(join(cwd, 'scripts', 'quality-baseline.json'))) {
    runScript('check:quality', ['--update']);
  }
  if (g.locGuard && !existsSync(join(cwd, 'scripts', 'loc-baseline.json'))) {
    runScript('check:loc', ['--update']);
  }
  if (g.coverageFloors && !isCoverageBaselined(cwd, options.testFramework ?? 'jest')) {
    // Delete any pre-existing coverage dir so the ratchet snapshots static-estimated
    // CRAP (matching CI, which has no coverage artifact).
    rmSync(join(cwd, 'coverage'), { recursive: true, force: true });
    runScript('test:coverage');
    applyCoverageFloor(cwd, options.testFramework ?? 'jest'); // floor = current (rise-only)
    // Leave the tree coverage-absent (the state CI uses) so the immediate local
    // check:quality can't disagree with the static_estimated baseline.
    rmSync(join(cwd, 'coverage'), { recursive: true, force: true });
  }
}
