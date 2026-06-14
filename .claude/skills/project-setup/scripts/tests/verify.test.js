// scripts/tests/verify.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runGates } from '../lib/verify.mjs';

test('runGates runs only enabled gates and aggregates pass/fail', () => {
  const ran = [];
  const exec = (cmd, args) => {
    ran.push(args.join(' '));
    if (args.includes('check:quality')) throw new Error('ratchet failed');
  };
  const res = runGates('/x', { guardrails: { eslintSeverityStaging: true, fallowRatchet: true, locGuard: false, coverageFloors: false } }, exec);
  assert.deepEqual(ran, ['run lint', 'run check:quality']);
  assert.equal(res.ok, false);
  assert.deepEqual(res.failed, ['check:quality']);
});
