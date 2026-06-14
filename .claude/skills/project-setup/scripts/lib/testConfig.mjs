// Resolve the test runner once (explicit answer -> detected -> Jest default) so
// every planner agrees. setup.mjs freezes options.testFramework before plan(),
// but resolving here too removes the hidden ordering dependency.
export function resolveFramework(options, state) {
  return options.testFramework ?? state?.testFramework ?? 'jest';
}

// Does the SELECTED runner already have a hand-written config we must not
// override? Jest ignores a vitest.config (and vice versa); Vitest also reads
// vite.config, which a generated vitest.config would override. Single source of
// truth for `effectiveOptions` (coverage-gate standdown) and `planTest` (don't
// write a competing config).
export function standsDownTestConfig(options, state) {
  const fw = resolveFramework(options, state);
  return fw === 'vitest'
    ? Boolean(state?.vitestConfig || state?.viteConfig)
    : Boolean(state?.jestConfig);
}
