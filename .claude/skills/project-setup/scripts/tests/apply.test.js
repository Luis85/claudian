// .claude/skills/project-setup/scripts/tests/apply.test.js
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { apply } from '../lib/apply.mjs';
import { tmpProject } from './helpers.js';

const actions = [
  { type: 'mergeText', path: '.gitignore', marker: 'project-setup', lines: ['.fallow/'] },
  { type: 'mergeJson', path: 'package.json', patch: { scripts: { report: 'node x.mjs' } } },
  { type: 'writeFile', path: 'project-setup.report.json', mode: 'overwrite-backup', content: '{"v":1}\n' },
];

test('apply writes/merges all actions on a fresh project', () => {
  const p = tmpProject({ 'package.json': { name: 'x' }, '.gitignore': 'node_modules/\n' });
  try {
    const res = apply(actions, { cwd: p.dir });
    assert.match(readFileSync(join(p.dir, '.gitignore'), 'utf8'), /\.fallow\//);
    assert.equal(JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')).scripts.report, 'node x.mjs');
    assert.ok(existsSync(join(p.dir, 'project-setup.report.json')));
    assert.ok(res.changed.length >= 3);
  } finally {
    p.cleanup();
  }
});

test('apply is idempotent: a second run changes nothing', () => {
  const p = tmpProject({ 'package.json': { name: 'x' }, '.gitignore': 'node_modules/\n' });
  try {
    apply(actions, { cwd: p.dir });
    const second = apply(actions, { cwd: p.dir });
    // mergeText/mergeJson are no-ops; the report is identical content so unchanged too.
    assert.deepEqual(second.changed, []);
  } finally {
    p.cleanup();
  }
});

test('dry-run mutates nothing but reports the plan', () => {
  const p = tmpProject({ 'package.json': { name: 'x' } });
  try {
    const res = apply(actions, { cwd: p.dir, dryRun: true });
    assert.equal(existsSync(join(p.dir, 'project-setup.report.json')), false);
    assert.ok(res.planned.length >= 3);
  } finally {
    p.cleanup();
  }
});

test('overwrite-backup backs up an existing file before replacing it', () => {
  const p = tmpProject({ 'project-setup.report.json': '{"old":true}\n', 'package.json': { name: 'x' } });
  try {
    apply(actions, { cwd: p.dir, backupDir: join(p.dir, '.bak') });
    assert.equal(readFileSync(join(p.dir, 'project-setup.report.json'), 'utf8'), '{"v":1}\n');
    const backups = readdirSync(join(p.dir, '.bak'));
    assert.ok(backups.includes('project-setup.report.json'));
  } finally {
    p.cleanup();
  }
});
