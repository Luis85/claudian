// scripts/lib/harness.mjs
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

export function planEslint(options) {
  if (!options.guardrails?.eslintSeverityStaging) return [];
  // Render the test-lint plugin import + config from the (resolved) test
  // framework so the test-lint guardrails actually run (setup.mjs resolves
  // options.testFramework before plan()).
  const { testImport, testConfigBlock } = eslintTestBlock(options.testFramework);
  const content = renderTemplate(loadTemplate('eslint.config.mjs.tmpl'), { testImport, testConfigBlock });
  return [
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
  yarn: { setup: '', cache: 'yarn', install: 'yarn install --immutable', run: 'yarn' },
};

export function planCi(options, state) {
  if (!options.github?.integrate || !options.guardrails?.ci) return [];
  const g = options.guardrails ?? {};
  const pm = CI_PM[options.packageManager ?? state?.packageManager] ?? CI_PM.npm;
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
  return [{ type: 'writeFile', path: '.github/workflows/ci.yml', mode: 'skip-if-exists', content }];
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

export function planDocs(options) {
  if (!options.docs?.scaffold) return [];
  // Document only the gates whose guardrail is enabled — otherwise the guide
  // tells users to run scripts that were never installed.
  const g = options.guardrails ?? {};
  const gates = [];
  if (g.eslintSeverityStaging) gates.push('- `npm run lint` — ESLint, error-tier rules (`warn` stages a backlog; promote warn->error as each reaches zero).');
  if (g.locGuard) gates.push(`- \`npm run check:loc\` — per-file LOC ratchet (cap ${options.locCap ?? 500}).`);
  if (g.fallowRatchet) gates.push('- `npm run check:quality` — fallow metric ratchet. **Run with ./coverage absent.**');
  if (g.coverageFloors) gates.push('- `npm run test:coverage` — coverage floors (rise-only; baselined to current).');
  const guide = renderTemplate(loadTemplate('docs/quality-integration-guide.md.tmpl'), {
    gates: gates.length ? gates.join('\n') : '_No blocking gates enabled._',
    testFramework: options.testFramework ?? 'jest',
  });
  const file = (path, name) => ({ type: 'writeFile', path, mode: 'skip-if-exists', content: loadTemplate(name) });
  return [
    file('CONTEXT.md', 'docs/CONTEXT.md'),
    file('docs/adr/0000-template.md', 'docs/adr-0000-template.md'),
    { type: 'writeFile', path: 'docs/quality-integration-guide.md', mode: 'skip-if-exists', content: guide },
    file('CONTRIBUTING.md', 'docs/CONTRIBUTING-quality.md'),
  ];
}
