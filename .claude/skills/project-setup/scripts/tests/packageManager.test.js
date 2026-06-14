// scripts/tests/packageManager.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runScriptArgs, safePackageManager } from '../lib/packageManager.mjs';

test('safePackageManager whitelists known managers and falls back to npm for anything else', () => {
  assert.equal(safePackageManager('pnpm'), 'pnpm');
  assert.equal(safePackageManager('yarn'), 'yarn');
  assert.equal(safePackageManager('/tmp/evil.sh'), 'npm'); // never exec a crafted binary
  assert.equal(safePackageManager(undefined), 'npm');
});

test('runScriptArgs(pnpm) returns [pnpm, [script]] (no run subcommand)', () => {
  assert.deepEqual(runScriptArgs('pnpm', 'test:coverage'), ['pnpm', ['test:coverage']]);
});

test('runScriptArgs(npm) returns [npm, [run, script]]', () => {
  assert.deepEqual(runScriptArgs('npm', 'test:coverage'), ['npm', ['run', 'test:coverage']]);
});

test('runScriptArgs(bun) returns [bun, [run, script]]', () => {
  assert.deepEqual(runScriptArgs('bun', 'test:coverage'), ['bun', ['run', 'test:coverage']]);
});

test('runScriptArgs(yarn) returns [yarn, [script]]', () => {
  assert.deepEqual(runScriptArgs('yarn', 'test:coverage'), ['yarn', ['test:coverage']]);
});

test('runScriptArgs with unknown pm falls back to npm', () => {
  assert.deepEqual(runScriptArgs('unknown', 'lint'), ['npm', ['run', 'lint']]);
});
