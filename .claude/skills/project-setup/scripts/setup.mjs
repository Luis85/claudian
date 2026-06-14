// .claude/skills/project-setup/scripts/setup.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { apply } from './lib/apply.mjs';
import { initBaselines } from './lib/baseline.mjs';
import { detect } from './lib/detect.mjs';
import { freezeOptions, loadOptions } from './lib/options.mjs';
import { runScriptArgs } from './lib/packageManager.mjs';
import { effectiveOptions, plan } from './lib/plan.mjs';
import { runGates } from './lib/verify.mjs';

const USAGE = `project-setup engine

Usage: node setup.mjs <command> [options]

Commands:
  detect                 Print project-state JSON. No mutation.
  plan   --config <f>    Print the ordered action plan. No mutation.
  apply  --config <f>    Execute the plan idempotently. --dry-run to preview.
  report                 Write the advisory quality report (quality-report.md + .json).
  verify                 Run the enabled gates once; non-zero exit on failure.

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
      let options;
      try {
        options = loadOptions(resolve(cwd, args.flags.config));
      } catch (e) {
        err(`${e.message}\n`);
        return 2;
      }
      const state = detect(cwd);
      // Freeze install-volatile fields so a post-install re-detect can't flip them
      // and break the "second apply is a no-op" contract (see freezeOptions).
      freezeOptions(options, readPriorReport(cwd)?.options, state);
      const actions = plan(options, state);
      const dryRun = cmd === 'plan' || args.flags.dryRun === true;
      const backupDir = args.flags.backupDir ? resolve(cwd, args.flags.backupDir) : undefined;
      if (backupDir && backupDir !== cwd && !backupDir.startsWith(cwd + sep)) {
        err('--backup-dir must be inside the project directory.\n');
        return 2;
      }
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
      // Separate real collisions (your file/script kept; a gate won't run) from
      // routine next steps (info) so a clean greenfield apply doesn't end with a
      // scary "review these" block.
      const warnings = (result.notices ?? []).filter((n) => n.level !== 'info');
      const infos = (result.notices ?? []).filter((n) => n.level === 'info');
      if (warnings.length) {
        out('\nNotices — your file/script was kept; the generated one did NOT apply (review):\n' + warnings.map((n) => `  - ${n.message}`).join('\n') + '\n');
      }
      if (infos.length) {
        out('\nNext steps:\n' + infos.map((n) => `  - ${n.message}`).join('\n') + '\n');
      }
      return 0;
    }
    case 'report': {
      const cwd = io.cwd ?? process.cwd();
      // Run the installed `report` script through the package manager (not bare
      // `node`) so Yarn PnP's loader is present for the report's
      // require.resolve('fallow/bin/fallow').
      const [bin, cargs] = runScriptArgs(detect(cwd).packageManager, 'report');
      execFileSync(bin, cargs, { cwd, stdio: 'inherit' });
      return 0;
    }
    case 'verify': {
      const cwd = io.cwd ?? process.cwd();
      if (!args.flags.config) {
        err('--config is required for verify.\n');
        return 2;
      }
      let options;
      try {
        options = loadOptions(resolve(cwd, args.flags.config));
      } catch (e) {
        err(`${e.message}\n`);
        return 2;
      }
      const state = detect(cwd);
      // Same resolution as apply, so verify runs the gates with the PM that
      // installed the harness and effectiveOptions sees the resolved runner.
      freezeOptions(options, readPriorReport(cwd)?.options, state);
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
