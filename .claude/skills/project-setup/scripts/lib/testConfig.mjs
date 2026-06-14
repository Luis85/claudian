// Does the SELECTED runner already have a hand-written config we must not
// override? Jest ignores a vitest.config (and vice versa); Vitest also reads
// vite.config, which a generated vitest.config would override. Single source of
// truth for `effectiveOptions` (coverage-gate standdown) and `planTest` (don't
// write a competing config).
export function standsDownTestConfig(options, state) {
  const fw = options.testFramework ?? state?.testFramework ?? 'jest';
  return fw === 'vitest'
    ? Boolean(state?.vitestConfig || state?.viteConfig)
    : Boolean(state?.jestConfig);
}
