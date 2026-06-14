// .claude/skills/project-setup/scripts/tests/plan.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { effectiveOptions, plan } from '../lib/plan.mjs';

const options = { guardrails: {}, github: { integrate: false }, docs: {} };
const state = { packageManager: 'npm', github: false };

test('plan returns an ordered array of known action types', () => {
  const actions = plan(options, state);
  assert.ok(Array.isArray(actions) && actions.length >= 2);
  for (const a of actions) {
    assert.ok(['mergeText', 'mergeJson', 'writeFile', 'installDeps', 'notice'].includes(a.type));
  }
});

test('effectiveOptions drops the coverage gate for the SELECTED runner\'s hand-written config', () => {
  // Jest selected + jest.config -> stand down; Jest selected + vitest.config -> not.
  assert.equal(effectiveOptions({ testFramework: 'jest', guardrails: { coverageFloors: true } }, { jestConfig: true }).guardrails.coverageFloors, false);
  assert.equal(effectiveOptions({ testFramework: 'jest', guardrails: { coverageFloors: true } }, { vitestConfig: true }).guardrails.coverageFloors, true);
  assert.equal(effectiveOptions({ guardrails: { coverageFloors: true } }, {}).guardrails.coverageFloors, true);
});

test('effectiveOptions stands the coverage gate down for a Vite config + resolved Vitest', () => {
  assert.equal(effectiveOptions({ testFramework: 'vitest', guardrails: { coverageFloors: true } }, { viteConfig: true }).guardrails.coverageFloors, false);
  // a vite.config but Jest selected -> not a Vitest config concern -> gate stays
  assert.equal(effectiveOptions({ testFramework: 'jest', guardrails: { coverageFloors: true } }, { viteConfig: true }).guardrails.coverageFloors, true);
});

test('plan ignores the engine artifacts in .gitignore', () => {
  const actions = plan(options, state);
  const gi = actions.find((a) => a.type === 'mergeText' && a.path === '.gitignore');
  assert.ok(gi, 'expected a .gitignore mergeText action');
  assert.ok(gi.lines.includes('.project-setup-backup/'));
  assert.ok(gi.lines.includes('.fallow/'));
});

test('plan writes a run report (overwrite-backup mode)', () => {
  const actions = plan(options, state);
  const report = actions.find((a) => a.path === 'project-setup.report.json');
  assert.ok(report);
  assert.equal(report.type, 'writeFile');
  assert.equal(report.mode, 'overwrite-backup');
  assert.match(report.content, /"engine"/);
});
