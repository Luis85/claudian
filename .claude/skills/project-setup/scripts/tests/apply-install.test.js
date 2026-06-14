// scripts/tests/apply-install.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apply } from '../lib/apply.mjs';
import { tmpProject } from './helpers.js';

test('installDeps runs the package manager when package.json changed, and is not a tracked change', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const calls = [];
  const exec = (cmd, args, opts) => calls.push({ cmd, args, cwd: opts.cwd });
  try {
    const res = apply([
      { type: 'mergeJson', path: 'package.json', patch: { devDependencies: { left: '1.0.0' } } },
      { type: 'installDeps', packageManager: 'pnpm' },
    ], { cwd: p.dir, exec });
    assert.deepEqual(calls, [{ cmd: 'pnpm', args: ['install'], cwd: p.dir }]);
    assert.ok(!res.changed.includes('(install)')); // install is an effect, not a tracked change
  } finally {
    p.cleanup();
  }
});

test('installDeps is skipped when package.json did not change (idempotent re-apply)', () => {
  const p = tmpProject({ 'package.json': { name: 'x', devDependencies: { left: '1.0.0' } } });
  const calls = [];
  try {
    apply([
      { type: 'mergeJson', path: 'package.json', patch: { devDependencies: { left: '1.0.0' } } },
      { type: 'installDeps', packageManager: 'npm' },
    ], { cwd: p.dir, exec: (...a) => calls.push(a) });
    assert.equal(calls.length, 0); // package.json already converged -> no install
  } finally {
    p.cleanup();
  }
});

test('installDeps is skipped in dry-run', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const calls = [];
  try {
    apply([{ type: 'installDeps', packageManager: 'npm' }], { cwd: p.dir, dryRun: true, exec: (...a) => calls.push(a) });
    assert.equal(calls.length, 0);
  } finally {
    p.cleanup();
  }
});
