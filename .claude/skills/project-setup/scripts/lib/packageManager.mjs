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
