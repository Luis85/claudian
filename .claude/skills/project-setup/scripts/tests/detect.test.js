// .claude/skills/project-setup/scripts/tests/detect.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detect, detectGithubRemote, detectPackageManager } from '../lib/detect.mjs';
import { tmpProject } from './helpers.js';

test('detectPackageManager reads the lockfile, defaults to npm', () => {
  const a = tmpProject({ 'pnpm-lock.yaml': '' });
  const b = tmpProject({});
  try {
    assert.equal(detectPackageManager(a.dir), 'pnpm');
    assert.equal(detectPackageManager(b.dir), 'npm');
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('detect reports tooling presence from package.json', () => {
  const p = tmpProject({
    'package.json': { devDependencies: { eslint: '^9', vitest: '^2', typescript: '^5' } },
    'tsconfig.json': '{}',
  });
  try {
    const state = detect(p.dir);
    assert.equal(state.eslint, true);
    assert.equal(state.fallow, false);
    assert.equal(state.testFramework, 'vitest');
    assert.equal(state.typescript, true);
  } finally {
    p.cleanup();
  }
});

test('detectPackageManager returns bun for a bun.lock file (v1.2+ text lockfile)', () => {
  const p = tmpProject({ 'bun.lock': '' });
  try {
    assert.equal(detectPackageManager(p.dir), 'bun');
  } finally {
    p.cleanup();
  }
});

test('detectPackageManager honors package.json#packageManager before the npm fallback', () => {
  const p = tmpProject({ 'package.json': { packageManager: 'pnpm@9.1.0' } }); // no lockfile yet
  try {
    assert.equal(detectPackageManager(p.dir), 'pnpm');
  } finally {
    p.cleanup();
  }
});

test('detectGithubRemote is true only when a github remote exists', () => {
  const gh = tmpProject({ '.git/config': '[remote "origin"]\n  url = https://github.com/o/r.git\n' });
  const gl = tmpProject({ '.git/config': '[remote "origin"]\n  url = https://gitlab.com/o/r.git\n' });
  try {
    assert.equal(detectGithubRemote(gh.dir), true);
    assert.equal(detectGithubRemote(gl.dir), false);
  } finally {
    gh.cleanup();
    gl.cleanup();
  }
});
