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

test('planEslint turns no-undef off (JS sources false-fail without declared globals)', () => {
  const cfg = planEslint(opts).find((a) => a.path === 'eslint.config.mjs');
  assert.match(cfg.content, /'no-undef': 'off'/);
});

test('planEslint stages EVERY preset error->warn (not just the named local rules)', () => {
  const cfg = planEslint({ ...opts, testFramework: 'jest' }).find((a) => a.path === 'eslint.config.mjs');
  assert.match(cfg.content, /const stage = \(config\)/); // the downgrade helper exists
  assert.match(cfg.content, /tseslint\.configs\.recommended\.map\(stage\)/); // TS preset staged
  assert.match(cfg.content, /stage\(js\.configs\.recommended\)/); // JS preset staged
  assert.match(cfg.content, /\.\.\.stage\(jestPlugin\.configs\['flat\/recommended'\]\)/); // jest staged
});

test('planEslint(vitest) stages the recommended test rules to warn', () => {
  const cfg = planEslint({ testFramework: 'vitest', guardrails: { eslintSeverityStaging: true } }).find((a) => a.path === 'eslint.config.mjs');
  assert.match(cfg.content, /staged\(vitestPlugin\.configs\.recommended\.rules\)/);
});

test('planEslint(JS) omits the TypeScript preset + import + dep', () => {
  const actions = planEslint({ typescript: false, testFramework: 'jest', guardrails: { eslintSeverityStaging: true } });
  const cfg = actions.find((a) => a.path === 'eslint.config.mjs');
  assert.doesNotMatch(cfg.content, /typescript-eslint/);
  assert.doesNotMatch(cfg.content, /@typescript-eslint/);
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.ok(!('typescript-eslint' in pkg.patch.devDependencies));
  assert.ok('eslint' in pkg.patch.devDependencies);
});

test('planEslint lints .mts/.cts in both the source and test globs', () => {
  const cfg = planEslint({ ...opts, testFramework: 'jest' }).find((a) => a.path === 'eslint.config.mjs');
  assert.match(cfg.content, /ts,mts,cts,tsx,js,mjs,cjs,jsx/); // source glob
  assert.match(cfg.content, /test,spec\}\.\{ts,mts,cts/); // test glob
});

test('planEslint reports a colliding lint script instead of silently keeping it', () => {
  const actions = planEslint(opts, { scripts: { lint: 'eslint src --max-warnings 0' } });
  assert.ok(actions.some((a) => a.type === 'notice' && /"lint" script kept/.test(a.message)));
});

test('planEslint reports a legacy .eslintrc alongside the flat config', () => {
  const actions = planEslint(opts, { legacyEslintrc: true });
  assert.ok(actions.some((a) => a.type === 'notice' && /eslintrc/i.test(a.message)));
});

test('planEslint reports an existing flat config in another extension (precedence collision)', () => {
  const actions = planEslint(opts, { eslintFlatConfig: true });
  assert.ok(actions.some((a) => a.type === 'notice' && /eslint\.config\.\{js,cjs,ts\}/.test(a.message)));
});

test('planEslint reports an existing same-name eslint.config.mjs (skip-if-exists keeps theirs)', () => {
  const actions = planEslint(opts, { eslintConfigMjs: true });
  assert.ok(actions.some((a) => a.type === 'notice' && /already have an eslint\.config\.mjs/.test(a.message)));
});

test('planEslint emits ONE eslint-config notice (highest precedence) when several config shapes exist', () => {
  const notices = planEslint(opts, { eslintConfigMjs: true, eslintFlatConfig: true, legacyEslintrc: true })
    .filter((a) => a.type === 'notice');
  assert.equal(notices.length, 1); // no overlapping/contradictory advice
  assert.match(notices[0].message, /already have an eslint\.config\.mjs/);
});

test('planEslint installs the test-lint plugin dep it imports (so lint resolves on the standdown path)', () => {
  const jestDeps = planEslint({ testFramework: 'jest', guardrails: { eslintSeverityStaging: true } }).find((a) => a.type === 'mergeJson').patch.devDependencies;
  assert.ok('eslint-plugin-jest' in jestDeps);
  const vitestDeps = planEslint({ testFramework: 'vitest', guardrails: { eslintSeverityStaging: true } }).find((a) => a.type === 'mergeJson').patch.devDependencies;
  assert.ok('eslint-plugin-vitest' in vitestDeps);
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
