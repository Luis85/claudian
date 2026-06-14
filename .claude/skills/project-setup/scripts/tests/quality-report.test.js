// scripts/tests/quality-report.test.js
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { planFallow, planReport } from '../lib/harness.mjs';
import { buildReport, detectRunCmd, extractData } from '../templates/quality-report.mjs';

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

test('buildReport never prints Grade F / 0% for a fresh repo with nothing to score', () => {
  const { markdown } = buildReport(extractData({ healthJson: {}, deadJson: {}, dupesJson: {}, coverageSummary: null }));
  assert.match(markdown, /n\/a \(new project/);
  assert.match(markdown, /no tests yet/);
  assert.doesNotMatch(markdown, /Grade F/);
  assert.match(markdown, /No action items/);
});

test('extractData maps fallow health findings/targets (not the nonexistent hotspots key)', () => {
  const healthJson = {
    health_score: { score: 72, grade: 'C' },
    summary: { severity_critical_count: 1 },
    findings: [
      { name: 'parseThing', path: 'src/p.ts', crap: 132, severity: 'critical' },
      { name: 'trivial', path: 'src/t.ts', crap: 3, severity: 'low' },
    ],
    targets: [{ category: 'add_test_coverage', recommendation: 'Add tests for src/p.ts', priority: 'high' }],
  };
  const d = extractData({ healthJson, deadJson: { summary: { total_issues: 2 } }, dupesJson: { stats: { clone_groups: 0 } }, coverageSummary: null });
  assert.equal(d.health.score, 72);
  assert.equal(d.health.criticalCount, 1);
  assert.equal(d.health.hotspots.length, 1); // only the critical/high finding
  assert.equal(d.health.hotspots[0].name, 'parseThing');
  const { markdown } = buildReport(d);
  assert.match(markdown, /Refactor complexity hotspot parseThing/);
  assert.match(markdown, /Add tests for src\/p\.ts/); // target surfaced
  assert.doesNotMatch(markdown, /No action items/); // a critical function must NOT read as green
});

test('buildReport renders action commands with the detected package manager', () => {
  const { markdown } = buildReport({ ...data, health: { score: 72, grade: 'C', hotspots: [] } }, 'pnpm');
  assert.match(markdown, /pnpm quality:dead-code/);
  assert.doesNotMatch(markdown, /npm run quality:dead-code/);
});

test('detectRunCmd resolves the package manager from the lockfile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qr-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    assert.equal(detectRunCmd(dir), 'pnpm');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planReport installs the detail scripts the report references (even when the ratchet is off)', () => {
  // planReport always runs; the report's actions point at these, so they live
  // here — not in planFallow, which a user can disable.
  const pkg = planReport().find((a) => a.type === 'mergeJson');
  assert.equal(pkg.patch.scripts.report, 'node scripts/quality-report.mjs');
  assert.equal(pkg.patch.scripts['quality:dead-code'], 'fallow dead-code');
  assert.equal(pkg.patch.scripts['quality:dupes'], 'fallow dupes');
  assert.ok('fallow' in pkg.patch.devDependencies);
  // planFallow no longer owns them (avoids the fallowRatchet-off gap).
  const fallowPkg = planFallow({ guardrails: { fallowRatchet: true } }, {}).find((a) => a.type === 'mergeJson');
  assert.ok(!('quality:dead-code' in fallowPkg.patch.scripts));
});

test('planReport reports an existing report-script collision', () => {
  const actions = planReport({}, { scripts: { report: 'my-old-report' } });
  assert.ok(actions.some((a) => a.type === 'notice' && /"report" script kept/.test(a.message)));
  const clean = planReport({}, { scripts: {} });
  assert.ok(!clean.some((a) => a.type === 'notice'));
});
