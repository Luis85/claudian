// scripts/tests/packageManager.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runScriptArgs } from '../lib/packageManager.mjs';

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
