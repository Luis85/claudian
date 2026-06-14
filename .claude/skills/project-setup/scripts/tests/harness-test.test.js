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

test('planLoc derives the LOC scan root from the entry (non-src layouts), skipping node_modules', () => {
  const lib = planLoc({ guardrails: { locGuard: true } }, { entry: 'lib/main.ts' }).find((a) => a.path === 'scripts/check-loc.mjs');
  assert.match(lib.content, /const SRC = join\(ROOT, 'lib'\)/);
  const root = planLoc({ guardrails: { locGuard: true } }, { entry: 'index.js' }).find((a) => a.path === 'scripts/check-loc.mjs');
  assert.match(root.content, /const SRC = join\(ROOT, '\.'\)/);
  assert.match(root.content, /IGNORE_DIRS/); // root walk must skip node_modules etc.
});

test('planLoc check-loc tracks modern module extensions (.mts/.cts/.cjs)', () => {
  const file = planLoc({ guardrails: { locGuard: true } }).find((a) => a.path === 'scripts/check-loc.mjs');
  assert.match(file.content, /mts\|cts/);
  assert.match(file.content, /\|cjs\)/);
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

test('planTest derives the coverage root from the detected entry (non-src / root layouts)', () => {
  const lib = planTest({ testFramework: 'jest', guardrails: { coverageFloors: true } }, { entry: 'lib/main.ts' }).find((a) => a.path === 'jest.config.mjs');
  assert.match(lib.content, /'lib\/\*\*\/\*\.\{/); // lib/, not src/
  assert.doesNotMatch(lib.content, /'src\//);
  const root = planTest({ testFramework: 'jest', guardrails: { coverageFloors: true } }, { entry: 'index.js' }).find((a) => a.path === 'jest.config.mjs');
  assert.match(root.content, /collectCoverageFrom: \['\*\*\/\*\.\{/); // repo-root glob
});

test('planTest coverage globs include modern module extensions (.cjs / .mts,.cts)', () => {
  const js = planTest({ testFramework: 'jest', typescript: false, guardrails: { coverageFloors: true } }).find((a) => a.path === 'jest.config.mjs');
  assert.match(js.content, /js,jsx,mjs,cjs/);
  assert.doesNotMatch(js.content, /ts,tsx/);
  const ts = planTest({ testFramework: 'jest', typescript: true, guardrails: { coverageFloors: true } }).find((a) => a.path === 'jest.config.mjs');
  assert.match(ts.content, /ts,tsx,mts,cts,js,jsx,mjs,cjs/); // TS repos cover their JS sources too
});

test('planTest(jest, JS) drops the ts-jest preset and its TS-only deps', () => {
  const actions = planTest({ testFramework: 'jest', typescript: false, guardrails: { coverageFloors: true } });
  const cfg = actions.find((a) => a.path === 'jest.config.mjs');
  assert.doesNotMatch(cfg.content, /ts-jest/); // JS has no tsconfig; ts-jest can't transform .js
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.ok(!('ts-jest' in pkg.patch.devDependencies));
  assert.ok(!('typescript' in pkg.patch.devDependencies));
  assert.ok('jest' in pkg.patch.devDependencies);
});

test('planTest(jest, TS) keeps the ts-jest preset', () => {
  const cfg = planTest({ testFramework: 'jest', typescript: true, guardrails: { coverageFloors: true } }).find((a) => a.path === 'jest.config.mjs');
  assert.match(cfg.content, /preset: 'ts-jest'/);
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
  const actions = planTest({ testFramework: 'jest', guardrails: { coverageFloors: true } }, { jestConfig: true });
  assert.ok(!actions.some((a) => a.path === 'jest.config.mjs')); // never write a competing config
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.test, 'jest --passWithNoTests'); // CI/verify's base test step must resolve
  assert.ok(!('test:coverage' in pkg.patch.scripts)); // but NOT the unbaselineable coverage gate
  assert.ok(actions.some((a) => a.type === 'notice' && /coverage gate was NOT wired/.test(a.message)));
});

test('planTest(vitest) hand-written config keeps a vitest test script', () => {
  const actions = planTest({ testFramework: 'vitest', guardrails: { coverageFloors: true } }, { vitestConfig: true });
  assert.equal(actions.find((a) => a.type === 'mergeJson').patch.scripts.test, 'vitest run --passWithNoTests');
});

test('planTest standdown installs the selected runner so its test script resolves', () => {
  const jestDeps = planTest({ testFramework: 'jest', guardrails: {} }, { jestConfig: true }).find((a) => a.type === 'mergeJson').patch.devDependencies;
  assert.ok('jest' in jestDeps);
  const vitestDeps = planTest({ testFramework: 'vitest', guardrails: {} }, { viteConfig: true }).find((a) => a.type === 'mergeJson').patch.devDependencies;
  assert.ok('vitest' in vitestDeps);
});

test('planTest does NOT stand down on the OTHER runner\'s config (Jest selected, vitest.config present)', () => {
  const actions = planTest({ testFramework: 'jest', typescript: true, guardrails: { coverageFloors: true } }, { vitestConfig: true });
  assert.ok(actions.some((a) => a.path === 'jest.config.mjs')); // Jest ignores vitest.config -> write jest config
});

test('planTest stands down for a Vite config when Vitest is the SELECTED runner (no vitest dep yet)', () => {
  const actions = planTest({ testFramework: 'vitest', guardrails: { coverageFloors: true } }, { viteConfig: true });
  assert.ok(!actions.some((a) => a.path === 'vitest.config.mjs')); // don't override their vite config
  assert.ok(actions.some((a) => a.type === 'notice' && /coverage gate was NOT wired/.test(a.message)));
});

test('planTest reports a test:coverage script collision', () => {
  const actions = planTest({ testFramework: 'jest', typescript: true, guardrails: { coverageFloors: true } }, { scripts: { 'test:coverage': 'old' } });
  assert.ok(actions.some((a) => a.type === 'notice' && /"test:coverage" script kept/.test(a.message)));
});
