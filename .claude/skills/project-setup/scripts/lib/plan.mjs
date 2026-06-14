// .claude/skills/project-setup/scripts/lib/plan.mjs
import {
  planCi, planDocs, planEslint, planFallow, planGithubMcp,
  planInstall, planLoc, planReport, planTest,
} from './harness.mjs';

const ENGINE_VERSION = '0.1.0';

function planGitignore() {
  return [
    {
      type: 'mergeText',
      path: '.gitignore',
      marker: 'project-setup',
      lines: ['.project-setup-backup/', '.fallow/', 'coverage/'],
    },
  ];
}

function planRunReport(options) {
  // Record only the resolved `options` (the stable desired config). NOT the raw
  // `detected` state: detection changes after the harness installs deps (eslint/
  // fallow/testFramework become present), which would make the report differ on
  // the next apply and break the second-apply no-op (idempotency).
  const report = {
    engine: ENGINE_VERSION,
    options,
  };
  return [
    {
      type: 'writeFile',
      path: 'project-setup.report.json',
      mode: 'overwrite-backup',
      content: JSON.stringify(report, null, 2) + '\n',
    },
  ];
}

function planHarness(options, state) {
  return [
    ...planEslint(options, state),
    ...planFallow(options, state),
    ...planLoc(options, state),
    ...planTest(options, state),
    ...planReport(options, state),
    ...planDocs(options, state),
    ...planCi(options, state),
    ...planGithubMcp(options, state),
    ...planInstall(options, state), // last: deps in package.json first
  ];
}

// State can force a guardrail off: a hand-written test config (or a Vite config
// when Vitest is the resolved runner — Vitest reads vite.config, which our
// vitest.config would override) can't be safely baselined, so the coverage gate
// stands down everywhere (planTest, planCi, initBaselines, and verify) to keep
// day-one CI green.
export function standsDownTestConfig(options, state) {
  const fw = options.testFramework ?? state?.testFramework ?? 'jest';
  // Scope to the resolved runner: Jest ignores a vitest.config (and vice versa),
  // so the other runner's config must NOT stand the gate down.
  return fw === 'vitest'
    ? Boolean(state?.vitestConfig || state?.viteConfig)
    : Boolean(state?.jestConfig);
}

export function effectiveOptions(options, state) {
  if (!standsDownTestConfig(options, state)) return options;
  return { ...options, guardrails: { ...(options.guardrails ?? {}), coverageFloors: false } };
}

// Ordered composition of pure sub-planners.
export function plan(options, state) {
  const opts = effectiveOptions(options, state);
  return [
    ...planGitignore(opts, state),
    ...planRunReport(opts),
    ...planHarness(opts, state),
  ];
}
