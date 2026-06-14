// scripts/tests/verify.test.js
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runGates } from '../lib/verify.mjs';
import { tmpProject } from './helpers.js';

test('runGates clears a stale coverage dir before the fallow gate (idempotent, coverage-absent)', () => {
  const p = tmpProject({ 'coverage/coverage-summary.json': '{}' });
  try {
    runGates(p.dir, { guardrails: { fallowRatchet: true, coverageFloors: false } }, () => {});
    assert.equal(existsSync(join(p.dir, 'coverage')), false);
  } finally {
    p.cleanup();
  }
});

test('runGates runs enabled gates + an always-on test gate, and aggregates pass/fail', () => {
  const ran = [];
  const exec = (cmd, args) => {
    ran.push(args.join(' '));
    if (args.includes('check:quality')) throw new Error('ratchet failed');
  };
  const res = runGates('/x', { guardrails: { eslintSeverityStaging: true, fallowRatchet: true, locGuard: false, coverageFloors: false } }, exec);
  assert.deepEqual(ran, ['run lint', 'run check:quality', 'run test']); // base test gate always runs
  assert.equal(res.ok, false);
  assert.deepEqual(res.failed, ['check:quality']);
});

test('runGates uses test:coverage as the test gate when coverage floors are on', () => {
  const ran = [];
  runGates('/x', { guardrails: { coverageFloors: true } }, (cmd, args) => ran.push(args.join(' ')));
  assert.deepEqual(ran, ['run test:coverage']);
});
