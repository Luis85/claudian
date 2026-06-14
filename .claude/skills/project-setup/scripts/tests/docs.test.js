// scripts/tests/docs.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planDocs } from '../lib/harness.mjs';

test('planDocs scaffolds the taxonomy and renders the guide from options', () => {
  const actions = planDocs({ docs: { scaffold: true }, testFramework: 'vitest', locCap: 500, guardrails: { locGuard: true, fallowRatchet: true } });
  const paths = actions.map((a) => a.path);
  assert.ok(paths.includes('CONTEXT.md'));
  assert.ok(paths.includes('docs/adr/0000-template.md'));
  assert.ok(paths.includes('docs/quality-integration-guide.md'));
  const guide = actions.find((a) => a.path === 'docs/quality-integration-guide.md');
  assert.match(guide.content, /\*\*vitest\*\*/);
  assert.match(guide.content, /cap 500/);
  for (const a of actions) assert.equal(a.mode, 'skip-if-exists'); // never clobber user docs
});

test('planDocs renders only the enabled gates in the guide', () => {
  const actions = planDocs({ docs: { scaffold: true }, testFramework: 'jest', guardrails: { eslintSeverityStaging: true, locGuard: false, fallowRatchet: false, coverageFloors: false } });
  const guide = actions.find((a) => a.path === 'docs/quality-integration-guide.md');
  assert.match(guide.content, /npm run lint/);
  assert.doesNotMatch(guide.content, /check:loc/);
  assert.doesNotMatch(guide.content, /check:quality/);
  assert.doesNotMatch(guide.content, /test:coverage/);
});

test('planDocs renders the detected package manager into the guide + CONTRIBUTING', () => {
  const actions = planDocs({ docs: { scaffold: true }, guardrails: { eslintSeverityStaging: true } }, { packageManager: 'pnpm' });
  const guide = actions.find((a) => a.path === 'docs/quality-integration-guide.md');
  const contributing = actions.find((a) => a.path === 'CONTRIBUTING.md');
  assert.match(guide.content, /pnpm lint/);
  assert.doesNotMatch(guide.content, /npm run lint/);
  assert.match(contributing.content, /pnpm lint/);
  assert.doesNotMatch(contributing.content, /npm run/);
});

test('CONTRIBUTING reflects only enabled gates and uses the coverage test gate', () => {
  const actions = planDocs(
    { docs: { scaffold: true }, guardrails: { eslintSeverityStaging: true, locGuard: false, fallowRatchet: false, coverageFloors: true } },
    {},
  );
  const c = actions.find((a) => a.path === 'CONTRIBUTING.md').content;
  assert.match(c, /npm run lint/);
  assert.doesNotMatch(c, /check:loc/); // disabled gate not advertised
  assert.doesNotMatch(c, /check:quality/);
  assert.match(c, /test:coverage/); // matches what CI/verify enforce
});

test('planDocs is a no-op when scaffold is off', () => {
  assert.deepEqual(planDocs({ docs: { scaffold: false } }), []);
});
