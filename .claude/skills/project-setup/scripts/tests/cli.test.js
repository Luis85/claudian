// .claude/skills/project-setup/scripts/tests/cli.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cli, parseArgs } from '../setup.mjs';

function capture() {
  const chunks = { out: '', err: '' };
  return {
    io: { stdout: (s) => (chunks.out += s), stderr: (s) => (chunks.err += s), cwd: process.cwd() },
    chunks,
  };
}

test('parseArgs collects positionals and valued flags', () => {
  const args = parseArgs(['apply', '--config', 'a.json', '--dry-run']);
  assert.equal(args._[0], 'apply');
  assert.equal(args.flags.config, 'a.json');
  assert.equal(args.flags.dryRun, true);
});

test('no command prints usage and exits 0', async () => {
  const { io, chunks } = capture();
  const code = await cli([], io);
  assert.equal(code, 0);
  assert.match(chunks.out, /Usage: node setup\.mjs/);
});

test('unknown command exits 2 with usage on stderr', async () => {
  const { io, chunks } = capture();
  const code = await cli(['frobnicate'], io);
  assert.equal(code, 2);
  assert.match(chunks.err, /Unknown command: frobnicate/);
});

test('verify with no --config exits 2', async () => {
  const { io, chunks } = capture();
  assert.equal(await cli(['verify'], io), 2);
  assert.match(chunks.err, /--config is required/);
});
