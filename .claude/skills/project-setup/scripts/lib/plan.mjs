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

function planRunReport(options, state) {
  const report = {
    engine: ENGINE_VERSION,
    options,
    detected: state,
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
    ...planRunReport(options, state),
    ...planHarness(options, state),
  ];
}
