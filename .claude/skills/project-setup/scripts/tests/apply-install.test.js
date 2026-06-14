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
    assert.ok(res.planned.includes('(install)')); // install is previewed in the plan
    assert.ok(!res.changed.includes('(install)')); // install is an effect, not a tracked change
  } finally {
    p.cleanup();
  }
});

test('installDeps is skipped when package.json did not change and a prior install completed', () => {
  const p = tmpProject({ 'package.json': { name: 'x', devDependencies: { left: '1.0.0' } }, '.project-setup-backup/.installed': '' });
  const calls = [];
  try {
    apply([
      { type: 'mergeJson', path: 'package.json', patch: { devDependencies: { left: '1.0.0' } } },
      { type: 'installDeps', packageManager: 'npm' },
    ], { cwd: p.dir, exec: (...a) => calls.push(a) });
    assert.equal(calls.length, 0); // converged + install marker present -> no install
  } finally {
    p.cleanup();
  }
});

test('installDeps RETRIES when package.json is unchanged but the prior install never completed', () => {
  const p = tmpProject({ 'package.json': { name: 'x', devDependencies: { left: '1.0.0' } } }); // no .installed marker
  const calls = [];
  try {
    apply([
      { type: 'mergeJson', path: 'package.json', patch: { devDependencies: { left: '1.0.0' } } },
      { type: 'installDeps', packageManager: 'npm' },
    ], { cwd: p.dir, exec: (cmd, args) => calls.push(`${cmd} ${args.join(' ')}`) });
    assert.deepEqual(calls, ['npm install']); // retried because install hadn't completed
  } finally {
    p.cleanup();
  }
});

test('installDeps is skipped in dry-run but still appears in planned', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  const calls = [];
  try {
    const res = apply([{ type: 'installDeps', packageManager: 'npm' }], { cwd: p.dir, dryRun: true, exec: (...a) => calls.push(a) });
    assert.equal(calls.length, 0);
    assert.ok(res.planned.includes('(install)'));
  } finally {
    p.cleanup();
  }
});
