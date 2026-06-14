// scripts/lib/harness.mjs
import { runPrefix } from './packageManager.mjs';
import { loadTemplate, renderTemplate } from './templates.mjs';

// EXACT pins (no caret/tilde). A first install with no lockfile must be
// reproducible — same answers + same state => same installed versions, per the
// spec's determinism guarantee. The resolved versions are also recorded in
// project-setup.report.json. Refresh deliberately to current exact releases
// (verify each with `npm view <pkg> version` when bumping).
export const PINNED = {
  eslint: '9.36.0',
  'typescript-eslint': '8.45.0',
  '@eslint/js': '9.36.0',
  'eslint-plugin-simple-import-sort': '12.1.1',
  fallow: '2.91.0',
  jest: '30.3.0',
  'ts-jest': '29.4.9',
  '@types/jest': '30.0.0',
  'eslint-plugin-jest': '28.14.0',
  vitest: '2.1.9',
  '@vitest/coverage-istanbul': '2.1.9',
  'eslint-plugin-vitest': '0.5.4',
  typescript: '5.9.3',
};

function dep(...names) {
  return Object.fromEntries(names.map((n) => [n, PINNED[n]]));
}

// A non-mutating action the engine surfaces to the user (collisions, skipped CI).
const notice = (message, level = 'warn') => ({ type: 'notice', level, message });

// Test-lint plugin wiring by framework. Empty when no framework (so eslint still
// installs); jest/vitest get their recommended test rules imported AND applied —
// otherwise the installed plugin would never run.
function eslintTestBlock(fw) {
  if (fw === 'jest') {
    return {
      testImport: "import jestPlugin from 'eslint-plugin-jest';",
      testConfigBlock: "  { files: ['**/*.{test,spec}.{ts,tsx,js,jsx}'], ...jestPlugin.configs['flat/recommended'] },",
    };
  }
  if (fw === 'vitest') {
    return {
      testImport: "import vitestPlugin from 'eslint-plugin-vitest';",
      testConfigBlock: "  { files: ['**/*.{test,spec}.{ts,tsx,js,jsx}'], plugins: { vitest: vitestPlugin }, rules: vitestPlugin.configs.recommended.rules },",
    };
  }
  return { testImport: '', testConfigBlock: '' };
}

export function planFallow(options, state) {
  if (!options.guardrails?.fallowRatchet) return [];
  const entry = state?.entry ?? 'src/index.ts';
  return [
    {
      type: 'writeFile',
      path: '.fallowrc.json',
      mode: 'skip-if-exists',
      content: renderTemplate(loadTemplate('fallowrc.json.tmpl'), { entry }),
    },
    {
      type: 'writeFile',
      path: 'scripts/check-quality.mjs',
      mode: 'overwrite-backup',
      content: loadTemplate('check-quality.mjs'),
    },
    {
      type: 'mergeJson',
      path: 'package.json',
      patch: {
        scripts: {
          quality: 'fallow',
          'quality:audit': 'fallow audit',
          'check:quality': 'node scripts/check-quality.mjs',
          // The advisory report points users at these; they must exist to run.
          'quality:dead-code': 'fallow dead-code',
          'quality:dupes': 'fallow dupes',
        },
        devDependencies: dep('fallow'),
      },
    },
  ];
}

export function planLoc(options) {
  if (!options.guardrails?.locGuard) return [];
  return [
    { type: 'writeFile', path: 'scripts/check-loc.mjs', mode: 'overwrite-backup', content: renderTemplate(loadTemplate('check-loc.mjs.tmpl'), { locCap: String(options.locCap ?? 500) }) },
    { type: 'mergeJson', path: 'package.json', patch: { scripts: { 'check:loc': 'node scripts/check-loc.mjs' } } },
  ];
}

export function planTest(options, state) {
  // Prefer an explicit answer, else the framework detected in the repo, else
  // Jest. This keeps a brownfield Vitest project on Vitest when the user accepts
  // the detected default.
  const fw = options.testFramework ?? state?.testFramework ?? 'jest';
  // A hand-written test config owns its thresholds; we can't safely baseline it
  // to current coverage (non-destructive), so wiring our coverage gate would risk
  // a day-one-RED CI on a pre-existing high threshold. Stand the gate down and
  // say so. (plan() drops coverageFloors for the same state, keeping CI/verify
  // consistent.) Still ensure a `test` script EXISTS so CI/verify's base test
  // step doesn't fail with "Missing script: test" — mergeJson keeps an existing
  // one and fills only when absent.
  if (state?.handwrittenTestConfig) {
    const testCmd = fw === 'vitest' ? 'vitest run --passWithNoTests' : 'jest --passWithNoTests';
    return [
      notice('Existing test config kept — the coverage gate was NOT wired (a hand-written config\'s thresholds can\'t be safely baselined to current). Set your thresholds to current coverage, or run `report` for an advisory snapshot.'),
      { type: 'mergeJson', path: 'package.json', patch: { scripts: { test: testCmd } } },
    ];
  }
  // Thresholds are filled by baseline; until then default to 0 (a no-op floor)
  // rendered as a JSON object so the config is valid immediately.
  const coverageThreshold = JSON.stringify(
    options.guardrails?.coverageFloors ? { statements: 0, branches: 0, functions: 0, lines: 0 } : {},
  );
  const coverageGlobs = options.typescript === false ? 'src/**/*.{js,jsx,mjs}' : 'src/**/*.{ts,tsx}';
  if (fw === 'vitest') {
    return [
      { type: 'writeFile', path: 'vitest.config.mjs', mode: 'skip-if-exists', content: renderTemplate(loadTemplate('vitest.config.mjs.tmpl'), { coverageThreshold, coverageGlobs }) },
      { type: 'mergeJson', path: 'package.json', patch: { scripts: { test: 'vitest run --passWithNoTests', 'test:coverage': 'vitest run --coverage --passWithNoTests' }, devDependencies: dep('vitest', '@vitest/coverage-istanbul', 'eslint-plugin-vitest', 'typescript') } },
    ];
  }
  return [
    { type: 'writeFile', path: 'jest.config.mjs', mode: 'skip-if-exists', content: renderTemplate(loadTemplate('jest.config.mjs.tmpl'), { coverageThreshold, coverageGlobs }) },
    { type: 'mergeJson', path: 'package.json', patch: { scripts: { test: 'jest --passWithNoTests', 'test:coverage': 'jest --coverage --passWithNoTests' }, devDependencies: dep('jest', 'ts-jest', '@types/jest', 'eslint-plugin-jest', 'typescript') } },
  ];
}

export function planEslint(options, state) {
  if (!options.guardrails?.eslintSeverityStaging) return [];
  // Render the test-lint plugin import + config from the (resolved) test
  // framework so the test-lint guardrails actually run (setup.mjs resolves
  // options.testFramework before plan()).
  const { testImport, testConfigBlock } = eslintTestBlock(options.testFramework);
  const content = renderTemplate(loadTemplate('eslint.config.mjs.tmpl'), { testImport, testConfigBlock });
  const notices = [];
  // Report (not silently no-op) the brownfield collisions: a kept `lint` script
  // means the generated config never runs through CI/verify, and a stray
  // `--max-warnings 0` there would invert the warn-staging policy.
  const existingLint = state?.scripts?.lint;
  if (existingLint && existingLint !== 'eslint .') {
    notices.push(notice(`Existing "lint" script kept (\`${existingLint}\`) — the generated eslint.config.mjs won't run through it, and a "--max-warnings 0" there would block on staged warnings. Point lint at \`eslint .\`, or add a separate \`lint:quality\` script.`));
  }
  if (state?.legacyEslintrc) {
    notices.push(notice('Legacy .eslintrc* found alongside the new flat eslint.config.mjs — ESLint 9 reads only the flat config; remove the legacy file once migrated.'));
  }
  return [
    ...notices,
    { type: 'writeFile', path: 'eslint.config.mjs', mode: 'skip-if-exists', content },
    {
      type: 'mergeJson',
      path: 'package.json',
      patch: {
        scripts: { lint: 'eslint .', 'lint:fix': 'eslint . --fix' },
        devDependencies: dep('eslint', 'typescript-eslint', '@eslint/js', 'eslint-plugin-simple-import-sort'),
      },
    },
  ];
}

// Per-package-manager CI rendering. npm/pnpm/yarn are fully supported; an
// unknown manager (incl. bun) falls back to npm-style so the workflow is valid.
const CI_PM = {
  npm: { setup: '', cache: 'npm', install: 'npm ci', run: 'npm run' },
  pnpm: { setup: '      - uses: pnpm/action-setup@v4\n        with: { version: 9 }\n', cache: 'pnpm', install: 'pnpm install --frozen-lockfile', run: 'pnpm' },
  // --frozen-lockfile (not Berry's --immutable): setup-node defaults to Yarn
  // Classic, which errors on --immutable. Berry accepts --frozen-lockfile too.
  yarn: { setup: '', cache: 'yarn', install: 'yarn install --frozen-lockfile', run: 'yarn' },
};

export function planCi(options, state) {
  if (!options.guardrails?.ci) return []; // CI not requested — nothing to surface
  // CI requested but unproducible: say so rather than silently dropping it.
  if (!options.github?.integrate) {
    return [notice('CI is enabled but GitHub integration is off, so no .github/workflows/ci.yml was written. Re-run with github.integrate:true to add it, or wire CI on your platform manually.')];
  }
  const g = options.guardrails ?? {};
  // npm/pnpm/yarn get a working workflow; bun (and any unknown manager) has no
  // profile — an npm-style CI would break a bun-only repo, so emit a notice and
  // let the agent wire CI manually rather than ship a broken workflow.
  const pmName = options.packageManager ?? state?.packageManager ?? 'npm';
  const pm = CI_PM[pmName];
  if (!pm) {
    return [notice(`CI is enabled but there's no built-in workflow profile for "${pmName}" — set up CI manually (npm/pnpm/yarn are generated automatically).`)];
  }
  const notices = [];
  if (state?.ciWorkflow) {
    notices.push(notice('Existing .github/workflows/ci.yml kept — the quality gates were NOT added to it. Merge the generated steps in, or they won\'t run in CI.'));
  }
  // Emit a CI step only for a guardrail that is actually installed (its npm
  // script exists). The test step is always present; it uses the coverage
  // variant when coverage floors are on.
  const steps = [];
  if (g.eslintSeverityStaging) steps.push(`      - run: ${pm.run} lint`);
  if (g.locGuard) steps.push(`      - run: ${pm.run} check:loc`);
  if (g.fallowRatchet) steps.push(`      - run: ${pm.run} check:quality   # runs with ./coverage absent`);
  steps.push(`      - run: ${pm.run} ${g.coverageFloors ? 'test:coverage' : 'test'}`);
  const content = renderTemplate(loadTemplate('ci.yml.tmpl'), {
    pmSetup: pm.setup, pmCache: pm.cache, pmInstall: pm.install, steps: steps.join('\n'),
  });
  return [...notices, { type: 'writeFile', path: '.github/workflows/ci.yml', mode: 'skip-if-exists', content }];
}

export function planInstall(options, state) {
  return [{ type: 'installDeps', packageManager: options.packageManager ?? state?.packageManager ?? 'npm' }];
}

export function planReport() {
  return [
    { type: 'writeFile', path: 'scripts/quality-report.mjs', mode: 'overwrite-backup', content: loadTemplate('quality-report.mjs') },
    // quality-report.mjs shells out to fallow, so pin + install it with the report.
    { type: 'mergeJson', path: 'package.json', patch: { scripts: { report: 'node scripts/quality-report.mjs' }, devDependencies: dep('fallow') } },
  ];
}

export function planGithubMcp(options) {
  if (!options.github?.integrate || !options.github?.mcp) return [];
  return [{ type: 'writeFile', path: '.mcp.json', mode: 'skip-if-exists', content: loadTemplate('mcp.json.tmpl') }];
}

export function planDocs(options, state) {
  if (!options.docs?.scaffold) return [];
  // Document only the gates whose guardrail is enabled — otherwise the guide
  // tells users to run scripts that were never installed. Render the run prefix
  // from the detected package manager so the commands work on pnpm/yarn/bun,
  // not just npm.
  const g = options.guardrails ?? {};
  const run = runPrefix(options.packageManager ?? state?.packageManager ?? 'npm');
  const gates = [];
  const gateScripts = [];
  if (g.eslintSeverityStaging) {
    gates.push(`- \`${run} lint\` — ESLint; opinionated rules start at \`warn\` (a staged backlog), promote warn->error as each reaches zero.`);
    gateScripts.push('lint');
  }
  if (g.locGuard) {
    gates.push(`- \`${run} check:loc\` — per-file LOC ratchet (cap ${options.locCap ?? 500}).`);
    gateScripts.push('check:loc');
  }
  if (g.fallowRatchet) {
    gates.push(`- \`${run} check:quality\` — fallow metric ratchet. **Run with ./coverage absent.**`);
    gateScripts.push('check:quality');
  }
  if (g.coverageFloors) gates.push(`- \`${run} test:coverage\` — coverage floors (rise-only; baselined to current).`);
  gateScripts.push(g.coverageFloors ? 'test:coverage' : 'test'); // always a test gate, like CI/verify
  // Advisory commands (the report script is always installed; fallow's sweep only when its ratchet is on).
  const advisory = [`- \`${run} report\` — actionable quality report (quality-report.md + .json).`];
  if (g.fallowRatchet) advisory.push(`- \`${run} quality\` / \`${run} quality:audit\` — fallow full sweep / changed-files review.`);
  const guide = renderTemplate(loadTemplate('docs/quality-integration-guide.md.tmpl'), {
    gates: gates.length ? gates.join('\n') : '_No blocking gates enabled._',
    verifyCmd: gateScripts.map((s) => `${run} ${s}`).join(' && '),
    advisory: advisory.join('\n'),
    testFramework: options.testFramework ?? 'jest',
  });
  const file = (path, name) => ({ type: 'writeFile', path, mode: 'skip-if-exists', content: loadTemplate(name) });
  return [
    file('CONTEXT.md', 'docs/CONTEXT.md'),
    file('docs/adr/0000-template.md', 'docs/adr-0000-template.md'),
    { type: 'writeFile', path: 'docs/quality-integration-guide.md', mode: 'skip-if-exists', content: guide },
    { type: 'writeFile', path: 'CONTRIBUTING.md', mode: 'skip-if-exists', content: renderTemplate(loadTemplate('docs/CONTRIBUTING-quality.md'), { runCmd: run }) },
  ];
}
