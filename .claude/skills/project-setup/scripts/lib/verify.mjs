// scripts/lib/verify.mjs
import { execFileSync } from 'node:child_process';

import { runScriptArgs } from './packageManager.mjs';

const defaultExec = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// Map each guardrail to the npm script that gates it.
const GATES = [
  ['eslintSeverityStaging', 'lint'],
  ['locGuard', 'check:loc'],
  ['fallowRatchet', 'check:quality'],
  ['coverageFloors', 'test:coverage'],
];

export function runGates(cwd, options, exec = defaultExec) {
  const g = options.guardrails ?? {};
  const failed = [];
  for (const [flag, script] of GATES) {
    if (!g[flag]) continue;
    try {
      const [cmd, cargs] = runScriptArgs(options.packageManager ?? 'npm', script);
      exec(cmd, cargs, { cwd });
    } catch {
      failed.push(script);
    }
  }
  return { ok: failed.length === 0, failed };
}
