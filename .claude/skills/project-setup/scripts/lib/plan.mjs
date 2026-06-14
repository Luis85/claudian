// .claude/skills/project-setup/scripts/lib/plan.mjs
import { planCi, planEslint, planFallow, planInstall, planLoc, planTest } from './harness.mjs';

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
    ...planCi(options, state),
    ...planInstall(options, state), // must be last so deps are in package.json first
  ];
}

// Ordered composition of pure sub-planners. Plans 2-3 add planHarness,
// planBaseline, planDocs, planGithub here.
export function plan(options, state) {
  return [
    ...planGitignore(options, state),
    ...planRunReport(options),
    ...planHarness(options, state),
  ];
}
