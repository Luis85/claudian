// .claude/skills/project-setup/scripts/tests/plan.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plan } from '../lib/plan.mjs';

const options = { guardrails: {}, github: { integrate: false }, docs: {} };
const state = { packageManager: 'npm', github: false };

test('plan returns an ordered array of known action types', () => {
  const actions = plan(options, state);
  assert.ok(Array.isArray(actions) && actions.length >= 2);
  for (const a of actions) {
    assert.ok(['mergeText', 'mergeJson', 'writeFile'].includes(a.type));
  }
});

test('plan ignores the engine artifacts in .gitignore', () => {
  const actions = plan(options, state);
  const gi = actions.find((a) => a.type === 'mergeText' && a.path === '.gitignore');
  assert.ok(gi, 'expected a .gitignore mergeText action');
  assert.ok(gi.lines.includes('.project-setup-backup/'));
  assert.ok(gi.lines.includes('.fallow/'));
});

test('plan writes a run report (create mode, never clobbering a user file)', () => {
  const actions = plan(options, state);
  const report = actions.find((a) => a.path === 'project-setup.report.json');
  assert.ok(report);
  assert.equal(report.type, 'writeFile');
  assert.equal(report.mode, 'overwrite-backup');
  assert.match(report.content, /"engine"/);
});
