// scripts/lib/harness.mjs
import { runPrefix, safePackageManager } from './packageManager.mjs';
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

// mergeJson keeps an existing scalar on conflict, so a brownfield script that
// shadows a guardrail's command means the guardrail silently never runs through
// `<pm> <name>` (CI/verify/docs). Report it rather than no-op.
function scriptCollision(state, name, desired) {
  const existing = state?.scripts?.[name];
  if (!existing || existing === desired) return [];
  return [notice(`Existing "${name}" script kept (\`${existing}\`) — \`<pm> ${name}\` runs yours, not the generated harness command (\`${desired}\`). Rename one so the ${name} guardrail actually runs.`)];
}

// Lint a wide test glob (incl. .mts/.cts/.cjs) so the test-lint guardrail isn't
// silently inert on those extensions.
const TEST_GLOB = "'**/*.{test,spec}.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'";

// Test-lint plugin wiring by framework. Empty when no framework (so eslint still
// installs); jest/vitest get their recommended test rules imported AND applied
// (staged to warn) — otherwise the installed plugin would never run, or would
// fail day-one CI on a focused/duplicate test.
function eslintTestBlock(fw) {
  if (fw === 'jest') {
    return {
      testImport: "import jestPlugin from 'eslint-plugin-jest';",
      testConfigBlock: `  { files: [${TEST_GLOB}], ...stage(jestPlugin.configs['flat/recommended']) },`,
    };
  }
  if (fw === 'vitest') {
    // Declare Vitest's globals: with `test.globals: true` the recommended rules
    // alone leave describe/it/expect undefined, so the base `no-undef` fails lint.
    const vitestGlobals = "{ suite: 'readonly', test: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', vi: 'readonly', expectTypeOf: 'readonly', assertType: 'readonly' }";
    return {
      testImport: "import vitestPlugin from 'eslint-plugin-vitest';",
      testConfigBlock: `  { files: [${TEST_GLOB}], languageOptions: { globals: ${vitestGlobals} }, plugins: { vitest: vitestPlugin }, rules: staged(vitestPlugin.configs.recommended.rules) },`,
    };
  }
  return { testImport: '', testConfigBlock: '' };
}

export function planFallow(options, state) {
  if (!options.guardrails?.fallowRatchet) return [];
  // JSON.stringify the entry array: `entry` comes from an untrusted repo's
  // filesystem (a crafted filename could break out of an unescaped JSON string
  // and inject keys into .fallowrc.json).
  const entry = JSON.stringify([state?.entry ?? 'src/index.ts']);
  return [
    ...scriptCollision(state, 'check:quality', 'node scripts/check-quality.mjs'),
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
        },
        devDependencies: dep('fallow'),
      },
    },
  ];
}

export function planLoc(options, state) {
  if (!options.guardrails?.locGuard) return [];
  return [
    ...scriptCollision(state, 'check:loc', 'node scripts/check-loc.mjs'),
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
  // Stand down on the SELECTED runner's hand-written config only (Jest ignores a
  // vitest.config and vice versa); Vitest also reads vite.config, which a generated
  // vitest.config would override.
  const handwritten = fw === 'vitest'
    ? Boolean(state?.vitestConfig || state?.viteConfig)
    : Boolean(state?.jestConfig);
  if (handwritten) {
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
  // Match the lint globs so coverage can't be dodged by a module extension; a TS
  // project also includes JS sources (ESLint lints both), so .js production code
  // in a TS repo isn't excluded from the floor.
  const coverageGlobs = options.typescript === false
    ? 'src/**/*.{js,jsx,mjs,cjs}'
    : 'src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
  if (fw === 'vitest') {
    return [
      ...scriptCollision(state, 'test:coverage', 'vitest run --coverage --passWithNoTests'),
      { type: 'writeFile', path: 'vitest.config.mjs', mode: 'skip-if-exists', content: renderTemplate(loadTemplate('vitest.config.mjs.tmpl'), { coverageThreshold, coverageGlobs }) },
      { type: 'mergeJson', path: 'package.json', patch: { scripts: { test: 'vitest run --passWithNoTests', 'test:coverage': 'vitest run --coverage --passWithNoTests' }, devDependencies: dep('vitest', '@vitest/coverage-istanbul', 'typescript') } },
    ];
  }
  // ts-jest preset + its deps only for a TypeScript project — on a JS-only repo
  // ts-jest with no tsconfig refuses to transform .js, so coverage never runs.
  const tsJest = options.typescript !== false;
  return [
    ...scriptCollision(state, 'test:coverage', 'jest --coverage --passWithNoTests'),
    { type: 'writeFile', path: 'jest.config.mjs', mode: 'skip-if-exists', content: renderTemplate(loadTemplate('jest.config.mjs.tmpl'), { coverageThreshold, coverageGlobs, presetLine: tsJest ? "  preset: 'ts-jest',\n" : '' }) },
    { type: 'mergeJson', path: 'package.json', patch: { scripts: { test: 'jest --passWithNoTests', 'test:coverage': 'jest --coverage --passWithNoTests' }, devDependencies: tsJest ? dep('jest', 'ts-jest', '@types/jest', 'typescript') : dep('jest') } },
  ];
}

export function planEslint(options, state) {
  if (!options.guardrails?.eslintSeverityStaging) return [];
  // Render the test-lint plugin import + config from the (resolved) test
  // framework so the test-lint guardrails actually run (setup.mjs resolves
  // options.testFramework before plan()).
  const { testImport, testConfigBlock } = eslintTestBlock(options.testFramework);
  // Only a TypeScript project loads the typescript-eslint preset; on a JS-only
  // repo it applies TS rules (e.g. no-require-imports) to .js and fails lint.
  const ts = options.typescript !== false;
  const content = renderTemplate(loadTemplate('eslint.config.mjs.tmpl'), {
    testImport,
    testConfigBlock,
    tsImport: ts ? "import tseslint from 'typescript-eslint';\n" : '',
    tsConfigs: ts ? '  ...tseslint.configs.recommended.map(stage),\n' : '',
    tsRules: ts
      ? "'@typescript-eslint/no-unused-vars': 'warn',\n      '@typescript-eslint/no-explicit-any': 'warn',\n      '@typescript-eslint/consistent-type-imports': 'warn',\n      "
      : '',
  });
  const notices = [
    ...scriptCollision(state, 'lint', 'eslint .'),
  ];
  if (state?.legacyEslintrc) {
    notices.push(notice('Legacy .eslintrc* found alongside the new flat eslint.config.mjs — ESLint 9 reads only the flat config; remove the legacy file once migrated.'));
  }
  if (state?.eslintFlatConfig) {
    notices.push(notice('An existing eslint.config.{js,cjs,ts} sits beside the generated eslint.config.mjs — ESLint loads only ONE (it checks .js before .mjs), so the staged config may not run. Remove/rename one, or merge the staged rules into yours.'));
  }
  if (state?.eslintConfigMjs) {
    notices.push(notice('You already have an eslint.config.mjs — the staged config was NOT written (skip-if-exists), so your config runs, not the severity-staged one. Merge the staged rules in, or back up and replace.'));
  }
  // The plugin DEP lives here (where its import is rendered), not in planTest —
  // planTest's hand-written-config path returns without deps, which would leave
  // the rendered `import eslint-plugin-{jest,vitest}` unresolved and break lint.
  const testPlugin = options.testFramework === 'jest' ? ['eslint-plugin-jest'] : options.testFramework === 'vitest' ? ['eslint-plugin-vitest'] : [];
  const deps = ts
    ? dep('eslint', 'typescript-eslint', '@eslint/js', 'eslint-plugin-simple-import-sort', ...testPlugin)
    : dep('eslint', '@eslint/js', 'eslint-plugin-simple-import-sort', ...testPlugin);
  return [
    ...notices,
    { type: 'writeFile', path: 'eslint.config.mjs', mode: 'skip-if-exists', content },
    {
      type: 'mergeJson',
      path: 'package.json',
      patch: {
        scripts: { lint: 'eslint .', 'lint:fix': 'eslint . --fix' },
        devDependencies: deps,
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
  // The generated CI does a strict install + dependency cache, both of which
  // require a committed lockfile — which a fresh `apply` creates but does not
  // commit. Tell the user, or day-one CI fails before any gate runs.
  const notices = [
    notice(`Commit your ${pmName} lockfile with the generated files — the CI runs \`${pm.install}\` + a dependency cache, which need a committed lockfile (a fresh apply creates one but doesn't commit it).`),
  ];
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
    defaultBranch: state?.defaultBranch ?? 'main',
  });
  return [...notices, { type: 'writeFile', path: '.github/workflows/ci.yml', mode: 'skip-if-exists', content }];
}

export function planInstall(options, state) {
  // safePackageManager: the value is exec'd as argv[0], so never pass an
  // unknown/crafted name through to the install.
  return [{ type: 'installDeps', packageManager: safePackageManager(options.packageManager ?? state?.packageManager ?? 'npm') }];
}

export function planReport(options, state) {
  return [
    ...scriptCollision(state, 'report', 'node scripts/quality-report.mjs'),
    { type: 'writeFile', path: 'scripts/quality-report.mjs', mode: 'overwrite-backup', content: loadTemplate('quality-report.mjs') },
    // The report shells out to fallow AND its action items point at quality:dead-code
    // / quality:dupes — install fallow and those scripts here (planReport always
    // runs), so the report's advice resolves even when the fallowRatchet gate is off.
    {
      type: 'mergeJson',
      path: 'package.json',
      patch: {
        scripts: {
          report: 'node scripts/quality-report.mjs',
          'quality:dead-code': 'fallow dead-code',
          'quality:dupes': 'fallow dupes',
        },
        devDependencies: dep('fallow'),
      },
    },
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
  const verifyCmd = gateScripts.map((s) => `${run} ${s}`).join(' && ');
  const guide = renderTemplate(loadTemplate('docs/quality-integration-guide.md.tmpl'), {
    gates: gates.length ? gates.join('\n') : '_No blocking gates enabled._',
    verifyCmd,
    advisory: advisory.join('\n'),
    testFramework: options.testFramework ?? 'jest',
  });
  const file = (path, name) => ({ type: 'writeFile', path, mode: 'skip-if-exists', content: loadTemplate(name) });
  return [
    file('CONTEXT.md', 'docs/CONTEXT.md'),
    file('docs/adr/0000-template.md', 'docs/adr-0000-template.md'),
    { type: 'writeFile', path: 'docs/quality-integration-guide.md', mode: 'skip-if-exists', content: guide },
    // Render CONTRIBUTING from the same enabled-gate command, so it never lists a
    // script that wasn't installed, and uses test:coverage when CI does.
    { type: 'writeFile', path: 'CONTRIBUTING.md', mode: 'skip-if-exists', content: renderTemplate(loadTemplate('docs/CONTRIBUTING-quality.md'), { runCmd: run, verifyCmd }) },
  ];
}
