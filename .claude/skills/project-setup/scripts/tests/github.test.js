// scripts/tests/github.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planGithubMcp } from '../lib/harness.mjs';
import { plan } from '../lib/plan.mjs';

test('planGithubMcp only emits .mcp.json when integrate AND mcp are opted in', () => {
  assert.deepEqual(planGithubMcp({ github: { integrate: true, mcp: false } }), []);
  assert.deepEqual(planGithubMcp({ github: { integrate: false, mcp: true } }), []);
  const actions = planGithubMcp({ github: { integrate: true, mcp: true } });
  assert.equal(actions[0].path, '.mcp.json');
  assert.match(actions[0].content, /fallow-mcp/);
});

test('plan() composes docs + report actions', () => {
  const actions = plan(
    { docs: { scaffold: true }, testFramework: 'jest', guardrails: { fallowRatchet: true }, github: { integrate: false } },
    { packageManager: 'npm', entry: 'src/index.ts' },
  );
  const paths = actions.map((a) => a.path);
  assert.ok(paths.includes('docs/quality-integration-guide.md'));
  assert.ok(paths.includes('scripts/quality-report.mjs'));
});
