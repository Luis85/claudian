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

test('planFallow JSON-escapes the entry (no .fallowrc injection from a crafted filename)', () => {
  const rc = planFallow({ guardrails: { fallowRatchet: true } }, { entry: 'src/a"], "evil": ["b.ts' }).find((a) => a.path === '.fallowrc.json');
  const parsed = JSON.parse(rc.content); // still valid JSON
  assert.deepEqual(parsed.entry, ['src/a"], "evil": ["b.ts']);
  assert.ok(!('evil' in parsed)); // no injected top-level key
});

test('planFallow ignores the generated harness scripts so fallow does not flag them as dead code', () => {
  const rc = planFallow({ guardrails: { fallowRatchet: true } }, { entry: 'src/index.ts' }).find((a) => a.path === '.fallowrc.json');
  const ignores = JSON.parse(rc.content).ignorePatterns;
  assert.ok(ignores.some((p) => p.endsWith('scripts/check-quality.mjs')));
  assert.ok(ignores.some((p) => p.endsWith('scripts/check-loc.mjs')));
  assert.ok(ignores.some((p) => p.endsWith('scripts/quality-report.mjs')));
});

test('planFallow ignores test files in the dead-code ratchet (writing tests must not trip it)', () => {
  const rc = planFallow({ guardrails: { fallowRatchet: true } }, { entry: 'src/index.ts' }).find((a) => a.path === '.fallowrc.json');
  const ignores = JSON.parse(rc.content).ignorePatterns;
  assert.ok(ignores.includes('**/*.test.*'));
  assert.ok(ignores.includes('**/*.spec.*'));
  assert.ok(ignores.some((p) => /tests/.test(p)));
});

test('planFallow reports a check:quality script collision (guardrail would silently not run)', () => {
  const actions = planFallow({ guardrails: { fallowRatchet: true } }, { scripts: { 'check:quality': 'old-cmd' } });
  assert.ok(actions.some((a) => a.type === 'notice' && /"check:quality" script kept/.test(a.message)));
});

test('script-collision notices render the real package manager, not a literal <pm>', () => {
  const n = planFallow({ packageManager: 'pnpm', guardrails: { fallowRatchet: true } }, { scripts: { 'check:quality': 'old' } }).find((a) => a.type === 'notice');
  assert.match(n.message, /pnpm check:quality/);
  assert.doesNotMatch(n.message, /<pm>/);
});

test('planFallow stands down for an existing fallow config in another form (would be shadowed by .fallowrc.json)', () => {
  // A repo with .fallowrc.jsonc / fallow.toml etc.: writing .fallowrc.json takes
  // precedence and shadows theirs, so the ratchet would gate the wrong graph.
  const actions = planFallow({ guardrails: { fallowRatchet: true } }, { entry: 'src/index.ts', fallowConfig: true });
  assert.ok(!actions.some((a) => a.path === '.fallowrc.json')); // never shadow their config
  assert.ok(actions.some((a) => a.type === 'notice' && /generated \.fallowrc\.json was NOT written/.test(a.message)));
  // The ratchet itself still installs and wraps `fallow` (now reading THEIR config).
  assert.ok(actions.some((a) => a.path === 'scripts/check-quality.mjs' && a.type === 'writeFile'));
  assert.equal(actions.find((a) => a.type === 'mergeJson').patch.scripts['check:quality'], 'node scripts/check-quality.mjs');
});

test('planFallow is a no-op when disabled', () => {
  assert.deepEqual(planFallow({ guardrails: { fallowRatchet: false } }, {}), []);
});
