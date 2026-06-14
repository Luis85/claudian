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
