// scripts/tests/harness-integration.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plan } from '../lib/plan.mjs';

const options = {
  testFramework: 'vitest',
  guardrails: { fallowRatchet: true, locGuard: true, eslintSeverityStaging: true, coverageFloors: true, ci: true },
  github: { integrate: true },
  docs: {},
};
const state = { packageManager: 'npm', entry: 'src/index.ts' };

test('plan now includes harness actions in a sane order (writes/deps before install)', () => {
  const actions = plan(options, state);
  const paths = actions.map((a) => a.path ?? `(${a.type})`);
  assert.ok(paths.includes('eslint.config.mjs'));
  assert.ok(paths.includes('.fallowrc.json'));
  assert.ok(paths.includes('vitest.config.mjs'));
  assert.ok(paths.includes('.github/workflows/ci.yml'));
  // install must come after all the file writes/merges
  const installIdx = actions.findIndex((a) => a.type === 'installDeps');
  const lastWriteIdx = actions.map((a) => a.type).lastIndexOf('writeFile');
  assert.ok(installIdx > lastWriteIdx, 'installDeps should be planned after file writes');
});
