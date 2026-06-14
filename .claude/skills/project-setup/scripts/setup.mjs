// .claude/skills/project-setup/scripts/setup.mjs
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
    case 'detect':
    case 'plan':
    case 'apply':
      // Wired to the lib modules in Task 6.
      err(`'${cmd}' is not wired yet.\n`);
      return 2;
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
