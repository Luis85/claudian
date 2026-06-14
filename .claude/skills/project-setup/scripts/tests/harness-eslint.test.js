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

test('planEslint stages the opinionated rules at warn (green day-one on brownfield)', () => {
  const cfg = planEslint(opts).find((a) => a.path === 'eslint.config.mjs');
  assert.match(cfg.content, /'no-console': 'warn'/);
  assert.match(cfg.content, /no-explicit-any': 'warn'/);
  assert.match(cfg.content, /no-unused-vars': 'warn'/);
  assert.doesNotMatch(cfg.content, /: 'error'/); // nothing ships at error
});

test('planEslint reports a colliding lint script instead of silently keeping it', () => {
  const actions = planEslint(opts, { scripts: { lint: 'eslint src --max-warnings 0' } });
  assert.ok(actions.some((a) => a.type === 'notice' && /"lint" script kept/.test(a.message)));
});

test('planEslint reports a legacy .eslintrc alongside the flat config', () => {
  const actions = planEslint(opts, { legacyEslintrc: true });
  assert.ok(actions.some((a) => a.type === 'notice' && /eslintrc/i.test(a.message)));
});

test('planEslint emits no collision notice on a clean greenfield repo', () => {
  const actions = planEslint(opts, { scripts: {}, legacyEslintrc: false });
  assert.ok(!actions.some((a) => a.type === 'notice'));
});

test('planEslint rendered config ignores the generated scripts and config files', () => {
  const cfg = planEslint(opts).find((a) => a.path === 'eslint.config.mjs');
  assert.match(cfg.content, /scripts\/check-quality\.mjs/);
  assert.match(cfg.content, /scripts\/check-loc\.mjs/);
  assert.match(cfg.content, /scripts\/quality-report\.mjs/);
  assert.match(cfg.content, /eslint\.config\.mjs/);
});

test('planEslint wires the test-lint plugin for the resolved framework', () => {
  const jestCfg = planEslint({ testFramework: 'jest', guardrails: { eslintSeverityStaging: true } })
    .find((a) => a.path === 'eslint.config.mjs');
  assert.match(jestCfg.content, /eslint-plugin-jest/);
  const vitestCfg = planEslint({ testFramework: 'vitest', guardrails: { eslintSeverityStaging: true } })
    .find((a) => a.path === 'eslint.config.mjs');
  assert.match(vitestCfg.content, /eslint-plugin-vitest/);
});

test('planEslint(vitest) declares the Vitest globals so no-undef passes on describe/it/expect', () => {
  const cfg = planEslint({ testFramework: 'vitest', guardrails: { eslintSeverityStaging: true } })
    .find((a) => a.path === 'eslint.config.mjs');
  assert.match(cfg.content, /languageOptions: \{ globals:/);
  assert.match(cfg.content, /expect: 'readonly'/);
  assert.match(cfg.content, /vi: 'readonly'/);
});
