// .claude/skills/project-setup/scripts/setup.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { apply } from './lib/apply.mjs';
import { initBaselines } from './lib/baseline.mjs';
import { detect } from './lib/detect.mjs';
import { loadOptions } from './lib/options.mjs';
import { runScriptArgs } from './lib/packageManager.mjs';
import { effectiveOptions, plan } from './lib/plan.mjs';
import { runGates } from './lib/verify.mjs';

const USAGE = `project-setup engine

Usage: node setup.mjs <command> [options]

Commands:
  detect                 Print project-state JSON. No mutation.
  plan   --config <f>    Print the ordered action plan. No mutation.
  apply  --config <f>    Execute the plan idempotently. --dry-run to preview.
  report                 Write the quality report. (Plan 3)
  verify                 Run the enabled gates once. (Plan 3)

Options:
  --config <file>        JSON options (answers).
  --dry-run              Plan only; never mutate.
  --backup-dir <dir>     Override backup location (default .project-setup-backup).
  -h, --help             Show this help.
`;

function readPriorReport(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, 'project-setup.report.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.flags.help = true;
    else if (a === '--dry-run') args.flags.dryRun = true;
    else if (a === '--config') args.flags.config = argv[++i];
    else if (a === '--backup-dir') args.flags.backupDir = argv[++i];
    else if (a.startsWith('--')) args.flags[a.slice(2)] = true;
    else args._.push(a);
  }
  return args;
}

export async function cli(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const err = io.stderr ?? ((s) => process.stderr.write(s));
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (args.flags.help || !cmd) {
    out(USAGE);
    return 0;
  }

  switch (cmd) {
    case 'detect': {
      out(JSON.stringify(detect(io.cwd ?? process.cwd()), null, 2) + '\n');
      return 0;
    }
    case 'plan':
    case 'apply': {
      const cwd = io.cwd ?? process.cwd();
      if (!args.flags.config) {
        err('--config is required for plan/apply.\n');
        return 2;
      }
      const options = loadOptions(resolve(cwd, args.flags.config));
      const state = detect(cwd);
      // Freeze install-volatile fields against the FIRST apply's resolution.
      // Once the harness installs typescript/jest/vitest, a re-detect flips these,
      // which would rewrite project-setup.report.json and re-trigger baselining —
      // breaking the "second apply is a no-op" contract. An explicit answer still
      // wins; otherwise the prior run report's resolved value is authoritative.
      const frozen = readPriorReport(cwd)?.options ?? {};
      options.testFramework = options.testFramework ?? frozen.testFramework ?? state.testFramework ?? 'jest';
      options.packageManager = options.packageManager ?? frozen.packageManager ?? state.packageManager ?? 'npm';
      options.typescript = options.typescript ?? frozen.typescript ?? state.typescript ?? true;
      const actions = plan(options, state);
      const dryRun = cmd === 'plan' || args.flags.dryRun === true;
      const backupDir = args.flags.backupDir ? resolve(cwd, args.flags.backupDir) : undefined;
      const result = apply(actions, { cwd, dryRun, backupDir, exec: io.exec });
      if (!dryRun && result.changed.length > 0) {
        // Effective options so baselining matches the plan (coverage gate may be off).
        initBaselines(cwd, effectiveOptions(options, state), io.exec); // snapshot current debt (brownfield-safe)
      }
      if (dryRun) {
        // Dedupe (package.json is touched by several planners) and name the
        // install step, so the preview reads as an approvable change list.
        const unique = [...new Set(result.planned)].map((p) =>
          p === '(install)' ? `install dependencies (${options.packageManager ?? 'npm'})` : p);
        out(`Planned ${unique.length} change(s):\n` + unique.map((p) => `  ${p}`).join('\n') + '\n');
      } else if (result.changed.length === 0) {
        out('No changes — project already converged.\n');
      } else {
        out(`Applied ${result.changed.length} change(s):\n` + result.changed.map((p) => `  ${p}`).join('\n') + '\n');
      }
      if (result.notices?.length) {
        out('\nNotices (review these):\n' + result.notices.map((n) => `  [${n.level}] ${n.message}`).join('\n') + '\n');
      }
      return 0;
    }
    case 'report': {
      const cwd = io.cwd ?? process.cwd();
      // Run the installed `report` script through the package manager (not bare
      // `node`) so Yarn PnP's loader is present for the report's
      // require.resolve('fallow/bin/fallow').
      const [cmd, cargs] = runScriptArgs(detect(cwd).packageManager, 'report');
      execFileSync(cmd, cargs, { cwd, stdio: 'inherit' });
      return 0;
    }
    case 'verify': {
      const cwd = io.cwd ?? process.cwd();
      if (!args.flags.config) {
        err('--config is required for verify.\n');
        return 2;
      }
      const options = loadOptions(resolve(cwd, args.flags.config));
      const state = detect(cwd);
      // Resolve the package manager the same way apply does (answer -> prior
      // report -> detected), so verify runs the gates with the PM that installed
      // the harness, not the npm fallback.
      options.packageManager = options.packageManager ?? readPriorReport(cwd)?.options?.packageManager ?? state.packageManager ?? 'npm';
      // Mirror plan(): a hand-written test config drops the coverage gate here too.
      const res = runGates(cwd, effectiveOptions(options, state), io.exec);
      out(res.ok ? 'All gates passed.\n' : `Gates failed: ${res.failed.join(', ')}\n`);
      return res.ok ? 0 : 1;
    }
    default:
      err(`Unknown command: ${cmd}\n${USAGE}`);
      return 2;
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  cli(process.argv.slice(2)).then((code) => process.exit(code));
}
