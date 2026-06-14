// .claude/skills/project-setup/scripts/lib/plan.mjs

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

// Ordered composition of pure sub-planners. Plans 2-3 add planHarness,
// planBaseline, planDocs, planGithub here.
export function plan(options, state) {
  return [...planGitignore(options, state), ...planRunReport(options, state)];
}
