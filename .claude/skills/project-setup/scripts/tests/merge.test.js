// .claude/skills/project-setup/scripts/tests/merge.test.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { backupFile, deepMerge, mergeJsonFile, mergeTextLines } from '../lib/merge.mjs';
import { tmpProject } from './helpers.js';

test('deepMerge keeps existing scalars, adds missing keys, unions arrays', () => {
  const base = { scripts: { lint: 'mine' }, keywords: ['a'] };
  const patch = { scripts: { lint: 'theirs', test: 'jest' }, keywords: ['a', 'b'] };
  assert.deepEqual(deepMerge(base, patch), {
    scripts: { lint: 'mine', test: 'jest' }, // existing 'lint' preserved
    keywords: ['a', 'b'],
  });
});

test('mergeJsonFile is idempotent', () => {
  const p = tmpProject({ 'package.json': { name: 'x', scripts: { build: 'tsc' } } });
  try {
    const path = join(p.dir, 'package.json');
    const first = mergeJsonFile(path, { scripts: { lint: 'eslint .' } });
    assert.equal(first.changed, true);
    // Apply the result, then merge the same patch again -> no change.
    const second = mergeJsonFile(path, { scripts: { build: 'tsc' } }, first.merged);
    assert.equal(second.changed, false);
  } finally {
    p.cleanup();
  }
});

test('mergeTextLines appends only missing lines', () => {
  const existing = 'node_modules/\ncoverage/\n';
  const r1 = mergeTextLines(existing, ['coverage/', '.fallow/'], 'project-setup');
  assert.match(r1.text, /\.fallow\//);
  assert.equal((r1.text.match(/coverage\//g) ?? []).length, 1); // not duplicated
  const r2 = mergeTextLines(r1.text, ['.fallow/'], 'project-setup');
  assert.equal(r2.changed, false);
});

test('backupFile copies an existing file into the backup dir', () => {
  const p = tmpProject({ 'eslint.config.mjs': 'export default []' });
  try {
    const dest = backupFile(join(p.dir, 'eslint.config.mjs'), join(p.dir, '.bak'));
    assert.ok(existsSync(dest));
    assert.equal(readFileSync(dest, 'utf8'), 'export default []');
    assert.equal(backupFile(join(p.dir, 'missing.txt'), join(p.dir, '.bak')), null);
  } finally {
    p.cleanup();
  }
});
