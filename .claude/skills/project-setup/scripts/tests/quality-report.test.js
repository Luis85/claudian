// scripts/tests/quality-report.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildReport } from '../templates/quality-report.mjs';

const data = {
  health: { score: 88.5, grade: 'B', hotspots: [{ name: 'foo', file: 'src/a.ts', crap: 42 }] },
  deadCode: { total_issues: 3 },
  dupes: { clone_groups: 5 },
  lintWarnings: { total: 12, byRule: { 'no-explicit-any': 12 } },
  locHotspots: [{ file: 'src/big.ts', loc: 740 }],
  coverage: { lines: 64 },
};

test('buildReport renders markdown + machine json with a prioritized action list', () => {
  const { markdown, json } = buildReport(data);
  assert.match(markdown, /# Quality report/);
  assert.match(markdown, /Grade.*B/);
  assert.match(markdown, /no-explicit-any/);
  assert.match(markdown, /## Act on this next/);
  assert.equal(json.health.grade, 'B');
  assert.ok(Array.isArray(json.actions) && json.actions.length > 0);
});

test('buildReport tolerates a clean project (no findings)', () => {
  const { markdown, json } = buildReport({
    health: { score: 100, grade: 'A', hotspots: [] },
    deadCode: { total_issues: 0 }, dupes: { clone_groups: 0 },
    lintWarnings: { total: 0, byRule: {} }, locHotspots: [], coverage: { lines: 100 },
  });
  assert.match(markdown, /No action items/);
  assert.deepEqual(json.actions, []);
});
