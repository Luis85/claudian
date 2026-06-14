// scripts/tests/harness-ci.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planCi, planInstall } from '../lib/harness.mjs';

test('planCi only emits the workflow when GitHub integration is opted in', () => {
  assert.deepEqual(planCi({ github: { integrate: false }, guardrails: { ci: true } }, { packageManager: 'npm' }), []);
  const actions = planCi(
    { github: { integrate: true }, guardrails: { ci: true, eslintSeverityStaging: true, locGuard: true, fallowRatchet: true, coverageFloors: true } },
    { packageManager: 'npm' },
  );
  const wf = actions.find((a) => a.path === '.github/workflows/ci.yml');
  assert.equal(wf.mode, 'skip-if-exists');
  assert.match(wf.content, /npm ci/);
  assert.match(wf.content, /npm run lint/);
  assert.match(wf.content, /npm run check:loc/);
  assert.match(wf.content, /npm run check:quality/);
  assert.match(wf.content, /npm run test:coverage/);
});

test('planCi gates each step on its guardrail flag (no step for a disabled guardrail)', () => {
  const actions = planCi(
    { github: { integrate: true }, guardrails: { ci: true, eslintSeverityStaging: true, locGuard: false, fallowRatchet: false, coverageFloors: false } },
    { packageManager: 'npm' },
  );
  const wf = actions.find((a) => a.path === '.github/workflows/ci.yml');
  assert.match(wf.content, /npm run lint/);
  assert.doesNotMatch(wf.content, /check:loc/); // guardrail off -> script absent -> no step
  assert.doesNotMatch(wf.content, /check:quality/);
  assert.match(wf.content, /npm run test\b/); // base test step always present
  assert.doesNotMatch(wf.content, /test:coverage/);
});

test('planCi renders the detected package manager (pnpm)', () => {
  const actions = planCi(
    { github: { integrate: true }, guardrails: { ci: true, fallowRatchet: true } },
    { packageManager: 'pnpm' },
  );
  const wf = actions.find((a) => a.path === '.github/workflows/ci.yml');
  assert.match(wf.content, /pnpm\/action-setup/);
  assert.match(wf.content, /pnpm install --frozen-lockfile/);
  assert.match(wf.content, /cache: pnpm/);
  assert.match(wf.content, /pnpm check:quality/);
});

test('planInstall emits one installDeps action for the detected package manager', () => {
  assert.deepEqual(planInstall({}, { packageManager: 'pnpm' }), [{ type: 'installDeps', packageManager: 'pnpm' }]);
});
