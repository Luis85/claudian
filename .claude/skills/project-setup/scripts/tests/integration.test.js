// .claude/skills/project-setup/scripts/tests/integration.test.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { cli } from '../setup.mjs';
import { tmpProject } from './helpers.js';

function capture(cwd) {
  const chunks = { out: '', err: '' };
  // Stub exec so installDeps and initBaselines never touch the network in tests.
  const exec = () => {};
  return { io: { stdout: (s) => (chunks.out += s), stderr: (s) => (chunks.err += s), cwd, exec }, chunks };
}

test('detect prints state JSON for the cwd', async () => {
  const p = tmpProject({ 'package.json': { devDependencies: { jest: '^30' } } });
  try {
    const { io, chunks } = capture(p.dir);
    const code = await cli(['detect'], io);
    assert.equal(code, 0);
    assert.equal(JSON.parse(chunks.out).testFramework, 'jest');
  } finally {
    p.cleanup();
  }
});

test('apply --config creates engine artifacts; second run is idempotent', async () => {
  // Pre-populate devDependencies with everything planHarness will merge so that
  // detect() produces an identical state on both runs. Without this, the first
  // run merges eslint/jest/typescript etc into package.json; on the second run
  // detect() picks them up and the state (and therefore the report) differs.
  const p = tmpProject({
    'package.json': {
      name: 'x',
      devDependencies: {
        jest: '30.3.0', 'ts-jest': '29.4.9', '@types/jest': '30.0.0',
        'eslint-plugin-jest': '28.14.0', typescript: '5.9.3',
        eslint: '9.36.0', 'typescript-eslint': '8.45.0', '@eslint/js': '9.36.0',
        'eslint-plugin-simple-import-sort': '12.1.1', fallow: '2.91.0',
      },
    },
    '.gitignore': 'node_modules/\n',
  });
  try {
    const cfg = join(p.dir, 'answers.json');
    writeFileSync(cfg, JSON.stringify({ guardrails: {}, github: { integrate: false }, docs: {} }));

    const first = capture(p.dir);
    assert.equal(await cli(['apply', '--config', cfg], first.io), 0);
    assert.ok(existsSync(join(p.dir, 'project-setup.report.json')));
    assert.match(readFileSync(join(p.dir, '.gitignore'), 'utf8'), /\.project-setup-backup\//);
    assert.match(first.chunks.out, /Applied/);

    const second = capture(p.dir);
    assert.equal(await cli(['apply', '--config', cfg], second.io), 0);
    assert.match(second.chunks.out, /No changes/);
  } finally {
    p.cleanup();
  }
});

test('plan --config --dry-run prints actions and mutates nothing', async () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  try {
    const cfg = join(p.dir, 'answers.json');
    writeFileSync(cfg, JSON.stringify({ guardrails: {}, github: { integrate: false }, docs: {} }));
    const { io, chunks } = capture(p.dir);
    assert.equal(await cli(['plan', '--config', cfg], io), 0);
    assert.equal(existsSync(join(p.dir, 'project-setup.report.json')), false);
    assert.match(chunks.out, /project-setup\.report\.json/);
  } finally {
    p.cleanup();
  }
});

test('apply without --config exits 2', async () => {
  const p = tmpProject({});
  try {
    const { io, chunks } = capture(p.dir);
    assert.equal(await cli(['apply'], io), 2);
    assert.match(chunks.err, /--config is required/);
  } finally {
    p.cleanup();
  }
});
