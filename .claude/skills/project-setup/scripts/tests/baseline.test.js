// scripts/tests/baseline.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initBaselines } from '../lib/baseline.mjs';
import { tmpProject } from './helpers.js';

test('initBaselines updates fallow + LOC before coverage, only for enabled guardrails', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const order = [];
  const exec = (cmd, args) => order.push(`${cmd} ${args.join(' ')}`);
  try {
    initBaselines(p.dir, { guardrails: { fallowRatchet: true, locGuard: true, coverageFloors: false } }, exec);
    assert.deepEqual(order, [
      'node scripts/check-quality.mjs --update',
      'node scripts/check-loc.mjs --update',
    ]);
  } finally {
    p.cleanup();
  }
});

test('coverage baseline runs last and is skipped when the guardrail is off', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const order = [];
  try {
    initBaselines(p.dir, { testFramework: 'jest', guardrails: { coverageFloors: true } },
      (cmd, args) => order.push(`${cmd} ${args.join(' ')}`));
    assert.equal(order[order.length - 1], 'npm run test:coverage');
  } finally {
    p.cleanup();
  }
});
