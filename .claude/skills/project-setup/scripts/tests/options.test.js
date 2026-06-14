// scripts/tests/options.test.js
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadOptions } from '../lib/options.mjs';

function withConfig(content) {
  const dir = mkdtempSync(join(tmpdir(), 'opt-'));
  const path = join(dir, 'answers.json');
  writeFileSync(path, content);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('loadOptions throws a clear error on malformed JSON', () => {
  const c = withConfig('{ not json');
  try {
    assert.throws(() => loadOptions(c.path), /Could not read answers JSON/);
  } finally {
    c.cleanup();
  }
});

test('loadOptions rejects a non-object answers file', () => {
  const c = withConfig('"hello"');
  try {
    assert.throws(() => loadOptions(c.path), /must be a JSON object/);
  } finally {
    c.cleanup();
  }
});

test('loadOptions sanitizes a non-integer locCap to the default (no code injection into check-loc.mjs)', () => {
  const c = withConfig(JSON.stringify({ locCap: '500;\nglobalThis.x=1' }));
  try {
    assert.equal(loadOptions(c.path).locCap, 500);
  } finally {
    c.cleanup();
  }
});

test('loadOptions keeps a valid integer locCap', () => {
  const c = withConfig(JSON.stringify({ locCap: 300 }));
  try {
    assert.equal(loadOptions(c.path).locCap, 300);
  } finally {
    c.cleanup();
  }
});
