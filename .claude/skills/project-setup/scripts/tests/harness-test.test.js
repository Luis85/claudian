// scripts/tests/harness-test.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planLoc, planTest } from '../lib/harness.mjs';

test('planLoc copies check-loc.mjs and adds the check:loc script', () => {
  const actions = planLoc({ guardrails: { locGuard: true } });
  assert.ok(actions.some((a) => a.path === 'scripts/check-loc.mjs'));
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts['check:loc'], 'node scripts/check-loc.mjs');
});

test('planLoc renders the locCap into MAX_LOC', () => {
  const actions = planLoc({ guardrails: { locGuard: true }, locCap: 300 });
  const file = actions.find((a) => a.path === 'scripts/check-loc.mjs');
  assert.match(file.content, /MAX_LOC = 300/);
});

test('planTest(jest) renders jest config + jest deps + test scripts', () => {
  const actions = planTest({ testFramework: 'jest', guardrails: { coverageFloors: true } });
  const cfg = actions.find((a) => a.path === 'jest.config.mjs');
  assert.match(cfg.content, /ts-jest/);
  assert.match(cfg.content, /"100"|\{[^}]*\}/); // placeholder threshold rendered to a JSON object
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.test, 'jest --passWithNoTests');
  assert.equal(pkg.patch.scripts['test:coverage'], 'jest --coverage --passWithNoTests');
  assert.ok('jest' in pkg.patch.devDependencies);
});

test('planTest(vitest) renders vitest config with the istanbul provider', () => {
  const actions = planTest({ testFramework: 'vitest', guardrails: { coverageFloors: true } });
  const cfg = actions.find((a) => a.path === 'vitest.config.mjs');
  assert.match(cfg.content, /istanbul/);
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.test, 'vitest run --passWithNoTests');
  assert.ok('@vitest/coverage-istanbul' in pkg.patch.devDependencies);
});

test('planTest(jest, typescript: false) uses js/jsx/mjs coverage globs', () => {
  const actions = planTest({ testFramework: 'jest', typescript: false, guardrails: { coverageFloors: true } });
  const cfg = actions.find((a) => a.path === 'jest.config.mjs');
  assert.match(cfg.content, /js,jsx,mjs/);
  assert.doesNotMatch(cfg.content, /ts,tsx/);
});

test('planTest requests the json-summary reporter the floor/report depend on', () => {
  const jestCfg = planTest({ testFramework: 'jest', guardrails: { coverageFloors: true } }).find((a) => a.path === 'jest.config.mjs');
  assert.match(jestCfg.content, /json-summary/);
  const vitestCfg = planTest({ testFramework: 'vitest', guardrails: { coverageFloors: true } }).find((a) => a.path === 'vitest.config.mjs');
  assert.match(vitestCfg.content, /json-summary/);
});

test('planTest falls back to the DETECTED framework when no explicit answer', () => {
  // options.testFramework null (user accepted the default) + detected vitest.
  const actions = planTest({ testFramework: null, guardrails: {} }, { testFramework: 'vitest' });
  assert.ok(actions.some((a) => a.path === 'vitest.config.mjs'));
  assert.ok(!actions.some((a) => a.path === 'jest.config.mjs'));
});

test('planTest stands the coverage gate down for a hand-written test config, but keeps a test script', () => {
  const actions = planTest({ testFramework: 'jest', guardrails: { coverageFloors: true } }, { handwrittenTestConfig: true });
  assert.ok(!actions.some((a) => a.path === 'jest.config.mjs')); // never write a competing config
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.test, 'jest --passWithNoTests'); // CI/verify's base test step must resolve
  assert.ok(!('test:coverage' in pkg.patch.scripts)); // but NOT the unbaselineable coverage gate
  assert.ok(actions.some((a) => a.type === 'notice' && /coverage gate was NOT wired/.test(a.message)));
});

test('planTest(vitest) hand-written config keeps a vitest test script', () => {
  const actions = planTest({ testFramework: 'vitest', guardrails: { coverageFloors: true } }, { handwrittenTestConfig: true });
  assert.equal(actions.find((a) => a.type === 'mergeJson').patch.scripts.test, 'vitest run --passWithNoTests');
});
