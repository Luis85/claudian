// scripts/lib/packageManager.mjs

// Args to run a package.json script with the given manager (matches CI/verify).
export function runScriptArgs(pm, script) {
  switch (pm) {
    case 'pnpm': return ['pnpm', [script]];
    case 'yarn': return ['yarn', [script]];
    case 'bun': return ['bun', ['run', script]];
    default: return ['npm', ['run', script]];
  }
}

// The command prefix a human types to run a script (for generated docs/readme).
export function runPrefix(pm) {
  return pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bun run' : 'npm run';
}
