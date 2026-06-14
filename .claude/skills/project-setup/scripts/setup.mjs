// .claude/skills/project-setup/scripts/setup.mjs
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { apply } from './lib/apply.mjs';
import { detect } from './lib/detect.mjs';
import { loadOptions } from './lib/options.mjs';
import { plan } from './lib/plan.mjs';

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
      const actions = plan(options, detect(cwd));
      const dryRun = cmd === 'plan' || args.flags.dryRun === true;
      const backupDir = args.flags.backupDir ? resolve(cwd, args.flags.backupDir) : undefined;
      const result = apply(actions, { cwd, dryRun, backupDir });
      if (dryRun) {
        out(`Planned ${result.planned.length} action(s):\n` + result.planned.map((p) => `  ${p}`).join('\n') + '\n');
      } else if (result.changed.length === 0) {
        out('No changes — project already converged.\n');
      } else {
        out(`Applied ${result.changed.length} change(s):\n` + result.changed.map((p) => `  ${p}`).join('\n') + '\n');
      }
      return 0;
    }
    case 'report':
    case 'verify':
      err(`'${cmd}' is not implemented yet (Plan 3).\n`);
      return 2;
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
