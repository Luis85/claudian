// .claude/skills/project-setup/scripts/tests/detect.test.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { detect, detectDefaultBranch, detectEntry, detectGithubRemote, detectPackageManager } from '../lib/detect.mjs';
import { tmpProject } from './helpers.js';

test('detectDefaultBranch returns the remote default, else main (never the current feature branch)', () => {
  const none = tmpProject({});
  const feature = tmpProject({});
  try {
    assert.equal(detectDefaultBranch(none.dir), 'main'); // no git
    execFileSync('git', ['init', '-b', 'feature/x'], { cwd: feature.dir, stdio: 'ignore' });
    assert.equal(detectDefaultBranch(feature.dir), 'main'); // no origin/HEAD -> NOT the feature branch
  } finally {
    none.cleanup();
    feature.cleanup();
  }
});

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

test('detectEntry returns src/main.ts when it exists, falling back to src/index.ts', () => {
  const withMain = tmpProject({ 'src/main.ts': '' });
  const empty = tmpProject({});
  try {
    assert.equal(detectEntry(withMain.dir), 'src/main.ts');
    assert.equal(detectEntry(empty.dir), 'src/index.ts');
  } finally {
    withMain.cleanup();
    empty.cleanup();
  }
});

test('detectEntry finds a JS/JSX app entrypoint, not only the .ts variant', () => {
  const jsApp = tmpProject({ 'src/app.jsx': '' });
  try {
    assert.equal(detectEntry(jsApp.dir), 'src/app.jsx');
  } finally {
    jsApp.cleanup();
  }
});

test('detectEntry strips a leading ./ and still skips ./dist build paths', () => {
  const srcDot = tmpProject({ 'package.json': { source: './src/index.ts' }, 'src/index.ts': '' });
  const distDot = tmpProject({ 'package.json': { main: './dist/index.js' }, 'dist/index.js': '' });
  try {
    assert.equal(detectEntry(srcDot.dir), 'src/index.ts'); // ./ normalized away
    assert.equal(detectEntry(distDot.dir), 'src/index.ts'); // ./dist still recognized as build -> fallback
  } finally {
    srcDot.cleanup();
    distDot.cleanup();
  }
});

test('detectEntry finds a lib/ entry (expanded source-dir candidates)', () => {
  const p = tmpProject({ 'lib/index.ts': '' });
  try {
    assert.equal(detectEntry(p.dir), 'lib/index.ts');
  } finally {
    p.cleanup();
  }
});

test('detectEntry uses main/module for a build-less package, but not a dist build path', () => {
  const core = tmpProject({ 'package.json': { main: 'core/index.js' }, 'core/index.js': '' });
  const dist = tmpProject({ 'package.json': { main: 'dist/index.js' }, 'dist/index.js': '' });
  try {
    assert.equal(detectEntry(core.dir), 'core/index.js'); // non-build dir -> used
    assert.equal(detectEntry(dist.dir), 'src/index.ts'); // dist is build output -> fallback
  } finally {
    core.cleanup();
    dist.cleanup();
  }
});

test('detectEntry matches modern module extensions (.mts/.cts/.cjs)', () => {
  const mts = tmpProject({ 'src/index.mts': '' });
  try {
    assert.equal(detectEntry(mts.dir), 'src/index.mts');
  } finally {
    mts.cleanup();
  }
});

test('detect flags an existing flat ESLint config in another extension', () => {
  const p = tmpProject({ 'eslint.config.js': 'export default [];\n' });
  try {
    assert.equal(detect(p.dir).eslintFlatConfig, true);
  } finally {
    p.cleanup();
  }
});

test('detect flags a user eslint.config.mjs but not the engine\'s own (marker)', () => {
  const theirs = tmpProject({ 'eslint.config.mjs': 'export default [];\n' });
  const ours = tmpProject({ 'eslint.config.mjs': '// Generated by project-setup\nexport default [];\n' });
  try {
    assert.equal(detect(theirs.dir).eslintConfigMjs, true);
    assert.equal(detect(ours.dir).eslintConfigMjs, false);
  } finally {
    theirs.cleanup();
    ours.cleanup();
  }
});

test('detect surfaces brownfield collision signals', () => {
  const p = tmpProject({
    'package.json': { scripts: { lint: 'eslint src' } },
    '.eslintrc.json': '{}',
    '.github/workflows/ci.yml': 'name: ci\n',
    'jest.config.js': 'module.exports = {};\n',
  });
  try {
    const s = detect(p.dir);
    assert.equal(s.scripts.lint, 'eslint src');
    assert.equal(s.legacyEslintrc, true);
    assert.equal(s.ciWorkflow, true);
    assert.equal(s.jestConfig, true);
  } finally {
    p.cleanup();
  }
});

test("detect does not flag the engine's own marked test config as hand-written", () => {
  const p = tmpProject({ 'jest.config.mjs': '// Generated by project-setup\nexport default {};\n' });
  try {
    assert.equal(detect(p.dir).jestConfig, false);
  } finally {
    p.cleanup();
  }
});

test('detect recognizes a package.json jest key and the .cts/.cjs config forms', () => {
  const pkgJest = tmpProject({ 'package.json': { jest: { testEnvironment: 'node' } } });
  const cts = tmpProject({ 'jest.config.cts': 'export default {};\n' });
  const viteCjs = tmpProject({ 'vite.config.cjs': 'module.exports = {};\n' });
  try {
    assert.equal(detect(pkgJest.dir).jestConfig, true); // package.json#jest -> Jest "Multiple configs" risk
    assert.equal(detect(cts.dir).jestConfig, true); // jest.config.cts
    assert.equal(detect(viteCjs.dir).viteConfig, true); // vite.config.cjs
  } finally {
    pkgJest.cleanup();
    cts.cleanup();
    viteCjs.cleanup();
  }
});

test('detect exposes per-runner config signals (scoped standdown is decided at plan time)', () => {
  const jestP = tmpProject({ 'jest.config.ts': 'export default {};\n' });
  const vitestP = tmpProject({ 'vitest.config.ts': 'export default {};\n' });
  const viteP = tmpProject({ 'vite.config.ts': 'export default {};\n' });
  try {
    assert.equal(detect(jestP.dir).jestConfig, true);
    assert.equal(detect(jestP.dir).vitestConfig, false);
    assert.equal(detect(vitestP.dir).vitestConfig, true);
    assert.equal(detect(viteP.dir).viteConfig, true);
    assert.equal(detect(viteP.dir).jestConfig, false); // Jest ignores vite.config
  } finally {
    jestP.cleanup();
    vitestP.cleanup();
    viteP.cleanup();
  }
});
