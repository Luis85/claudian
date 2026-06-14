// scripts/tests/harness-eslint.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planEslint } from '../lib/harness.mjs';

const opts = { typescript: true, guardrails: { eslintSeverityStaging: true } };

test('planEslint writes a flat config (skip-if-exists) and adds the lint script + deps', () => {
  const actions = planEslint(opts);
  const cfg = actions.find((a) => a.path === 'eslint.config.mjs');
  assert.equal(cfg.type, 'writeFile');
  assert.equal(cfg.mode, 'skip-if-exists'); // never clobber an existing config
  assert.match(cfg.content, /no-console/);
  assert.match(cfg.content, /simple-import-sort/);

  const pkg = actions.find((a) => a.type === 'mergeJson' && a.path === 'package.json');
  assert.equal(pkg.patch.scripts.lint, 'eslint .');
  assert.ok('eslint' in pkg.patch.devDependencies);
});

test('planEslint is a no-op when the guardrail is disabled', () => {
  assert.deepEqual(planEslint({ guardrails: { eslintSeverityStaging: false } }), []);
});

test('planEslint wires the test-lint plugin for the resolved framework', () => {
  const jestCfg = planEslint({ testFramework: 'jest', guardrails: { eslintSeverityStaging: true } })
    .find((a) => a.path === 'eslint.config.mjs');
  assert.match(jestCfg.content, /eslint-plugin-jest/);
  const vitestCfg = planEslint({ testFramework: 'vitest', guardrails: { eslintSeverityStaging: true } })
    .find((a) => a.path === 'eslint.config.mjs');
  assert.match(vitestCfg.content, /eslint-plugin-vitest/);
});
