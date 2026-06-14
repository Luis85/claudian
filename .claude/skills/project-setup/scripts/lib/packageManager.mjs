// scripts/lib/packageManager.mjs

// Args to run a package.json script with the given manager (matches CI/verify).
// `extra` is forwarded to the script (npm needs the `--` separator).
export function runScriptArgs(pm, script, extra = []) {
  switch (pm) {
    case 'pnpm': return ['pnpm', [script, ...extra]];
    case 'yarn': return ['yarn', [script, ...extra]];
    case 'bun': return ['bun', ['run', script, ...extra]];
    default: return ['npm', extra.length ? ['run', script, '--', ...extra] : ['run', script]];
  }
}

// The command prefix a human types to run a script (for generated docs/readme).
export function runPrefix(pm) {
  return pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bun run' : 'npm run';
}
