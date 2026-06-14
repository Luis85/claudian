// scripts/tests/harness-fallow.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planFallow } from '../lib/harness.mjs';

test('planFallow renders .fallowrc.json with the detected entry and copies the ratchet script', () => {
  const actions = planFallow({ guardrails: { fallowRatchet: true } }, { entry: 'src/index.ts' });
  const rc = actions.find((a) => a.path === '.fallowrc.json');
  assert.match(rc.content, /"src\/index\.ts"/);
  assert.ok(actions.some((a) => a.path === 'scripts/check-quality.mjs' && a.type === 'writeFile'));
  const pkg = actions.find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts['check:quality'], 'node scripts/check-quality.mjs');
  assert.equal(pkg.patch.scripts.quality, 'fallow');
});

test('planFallow is a no-op when disabled', () => {
  assert.deepEqual(planFallow({ guardrails: { fallowRatchet: false } }, {}), []);
});
