// scripts/tests/harness-ci.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planCi, planInstall } from '../lib/harness.mjs';

test('planCi only emits the workflow when GitHub integration is opted in', () => {
  // CI on + GitHub off: a notice, NOT a silent skip (the workflow can't be written).
  const offGithub = planCi({ github: { integrate: false }, guardrails: { ci: true } }, { packageManager: 'npm' });
  assert.equal(offGithub.find((a) => a.path === '.github/workflows/ci.yml'), undefined);
  assert.ok(offGithub.some((a) => a.type === 'notice' && /GitHub integration is off/.test(a.message)));
  // CI not requested at all: silent — nothing to surface.
  assert.deepEqual(planCi({ github: { integrate: false }, guardrails: { ci: false } }, { packageManager: 'npm' }), []);
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
  assert.match(wf.content, /version: 9/);
});

test('planCi emits a notice for bun instead of a broken npm-style workflow', () => {
  const actions = planCi({ github: { integrate: true }, guardrails: { ci: true } }, { packageManager: 'bun' });
  assert.equal(actions.find((a) => a.path === '.github/workflows/ci.yml'), undefined);
  assert.ok(actions.some((a) => a.type === 'notice' && /bun/.test(a.message)));
});

test('planCi emits a notice when an existing ci.yml would be left untouched', () => {
  const actions = planCi(
    { github: { integrate: true }, guardrails: { ci: true, fallowRatchet: true } },
    { packageManager: 'npm', ciWorkflow: true },
  );
  assert.ok(actions.find((a) => a.path === '.github/workflows/ci.yml')); // still writes (skip-if-exists)
  assert.ok(actions.some((a) => a.type === 'notice' && /ci\.yml kept/.test(a.message)));
});

test('planCi targets the detected default branch, not a hardcoded main', () => {
  const wf = planCi(
    { github: { integrate: true }, guardrails: { ci: true, fallowRatchet: true } },
    { packageManager: 'npm', defaultBranch: 'develop' },
  ).find((a) => a.path === '.github/workflows/ci.yml');
  assert.match(wf.content, /branches: \[develop\]/);
  assert.doesNotMatch(wf.content, /\[main\]/);
});

test('planCi reminds the user to commit the lockfile as an INFO next step (not a collision)', () => {
  const actions = planCi(
    { github: { integrate: true }, guardrails: { ci: true, fallowRatchet: true } },
    { packageManager: 'pnpm' },
  );
  const n = actions.find((a) => a.type === 'notice' && /lockfile/.test(a.message));
  assert.ok(n);
  assert.equal(n.level, 'info');
});

test('planInstall emits one installDeps action for the detected package manager', () => {
  assert.deepEqual(planInstall({}, { packageManager: 'pnpm' }), [{ type: 'installDeps', packageManager: 'pnpm' }]);
});

test('planInstall sanitizes an unknown/crafted package manager to npm (never exec it)', () => {
  assert.deepEqual(planInstall({ packageManager: '/tmp/evil.sh' }, {}), [{ type: 'installDeps', packageManager: 'npm' }]);
});

test('planInstall: resolved option wins over state (options.packageManager takes precedence)', () => {
  assert.deepEqual(
    planInstall({ packageManager: 'pnpm' }, { packageManager: 'npm' }),
    [{ type: 'installDeps', packageManager: 'pnpm' }],
  );
});

test('planCi: resolved option wins over state (options.packageManager takes precedence)', () => {
  const actions = planCi(
    { packageManager: 'pnpm', github: { integrate: true }, guardrails: { ci: true } },
    { packageManager: 'npm' },
  );
  const wf = actions.find((a) => a.path === '.github/workflows/ci.yml');
  assert.match(wf.content, /pnpm install --frozen-lockfile/);
});
