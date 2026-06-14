// scripts/lib/verify.mjs
import { execFileSync } from 'node:child_process';

import { runScriptArgs } from './packageManager.mjs';

const defaultExec = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// Each guardrail maps to the npm script that gates it. The test gate is ALWAYS
// run (mirroring the generated CI workflow): test:coverage when coverage floors
// are on, else the plain test script — so local verify can't pass while CI fails.
const GATES = [
  ['eslintSeverityStaging', 'lint'],
  ['locGuard', 'check:loc'],
  ['fallowRatchet', 'check:quality'],
];

export function runGates(cwd, options, exec = defaultExec) {
  const g = options.guardrails ?? {};
  const pm = options.packageManager ?? 'npm';
  const failed = [];
  const run = (script) => {
    try {
      const [cmd, cargs] = runScriptArgs(pm, script);
      exec(cmd, cargs, { cwd });
    } catch {
      failed.push(script);
    }
  };
  for (const [flag, script] of GATES) {
    if (g[flag]) run(script);
  }
  run(g.coverageFloors ? 'test:coverage' : 'test'); // always run a test gate, like CI
  return { ok: failed.length === 0, failed };
}
