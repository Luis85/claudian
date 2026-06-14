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

test('planTest(jest) renders jest config + jest deps + test scripts', () => {
  const actions = planTest({ testFramework: 'jest', guardrails: { coverageFloors: true } });
  const cfg = actions.find((a) => a.path === 'jest.config.mjs');
  assert.match(cfg.content, /ts-jest/);
  assert.match(cfg.content, /"100"|\{[^}]*\}/); // placeholder threshold rendered to a JSON object
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.test, 'jest');
  assert.equal(pkg.patch.scripts['test:coverage'], 'jest --coverage');
  assert.ok('jest' in pkg.patch.devDependencies);
});

test('planTest(vitest) renders vitest config with the istanbul provider', () => {
  const actions = planTest({ testFramework: 'vitest', guardrails: { coverageFloors: true } });
  const cfg = actions.find((a) => a.path === 'vitest.config.mjs');
  assert.match(cfg.content, /istanbul/);
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.test, 'vitest run');
  assert.ok('@vitest/coverage-istanbul' in pkg.patch.devDependencies);
});

test('planTest falls back to the DETECTED framework when no explicit answer', () => {
  // options.testFramework null (user accepted the default) + detected vitest.
  const actions = planTest({ testFramework: null, guardrails: {} }, { testFramework: 'vitest' });
  assert.ok(actions.some((a) => a.path === 'vitest.config.mjs'));
  assert.ok(!actions.some((a) => a.path === 'jest.config.mjs'));
});
