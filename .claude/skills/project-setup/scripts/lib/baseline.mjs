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
  // Run the GENERATED ratchet FILE directly (not the `check:quality`/`check:loc`
  // npm script, which a brownfield repo may have shadowed with a different command
  // — mergeJson keeps theirs). `yarn node` carries Yarn PnP's loader for
  // check-quality.mjs's require.resolve('fallow/bin/fallow'); bare node elsewhere.
  const runRatchet = (file, ...args) => {
    const [cmd, cargs] = pm === 'yarn' ? ['yarn', ['node', file, ...args]] : ['node', [file, ...args]];
    exec(cmd, cargs, { cwd });
  };
  if (g.fallowRatchet && !existsSync(join(cwd, 'scripts', 'quality-baseline.json'))) {
    // Remove any pre-existing coverage BEFORE the fallow baseline: a stray
    // ./coverage flips fallow CRAP to coverage-weighted, which would bless inflated
    // complexity debt into the baseline (docs/CI require coverage absent). Scoped to
    // the fallow-baseline path so a fully-baselined re-apply is a true no-op.
    rmSync(join(cwd, 'coverage'), { recursive: true, force: true });
    runRatchet('scripts/check-quality.mjs', '--update');
  }
  if (g.locGuard && !existsSync(join(cwd, 'scripts', 'loc-baseline.json'))) {
    runRatchet('scripts/check-loc.mjs', '--update');
  }
  if (g.coverageFloors && !isCoverageBaselined(cwd, options.testFramework ?? 'jest')) {
    // Delete any pre-existing coverage dir so the ratchet snapshots static-estimated
    // CRAP (matching CI, which has no coverage artifact).
    rmSync(join(cwd, 'coverage'), { recursive: true, force: true });
    // The test runner IS the user-facing npm script (jest/vitest), so run it via PM.
    const [cmd, cargs] = runScriptArgs(pm, 'test:coverage');
    exec(cmd, cargs, { cwd });
    applyCoverageFloor(cwd, options.testFramework ?? 'jest'); // floor = current (rise-only)
    // Leave the tree coverage-absent (the state CI uses) so the immediate local
    // check:quality can't disagree with the static_estimated baseline.
    rmSync(join(cwd, 'coverage'), { recursive: true, force: true });
  }
}
