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

test('planDocs is a no-op when scaffold is off', () => {
  assert.deepEqual(planDocs({ docs: { scaffold: false } }), []);
});
