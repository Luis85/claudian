// scripts/tests/e2e.test.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { apply } from '../lib/apply.mjs';
import { detect } from '../lib/detect.mjs';
import { loadOptions } from '../lib/options.mjs';
import { plan } from '../lib/plan.mjs';
import { cli } from '../setup.mjs';
import { tmpProject } from './helpers.js';

function setup(dir, answers) {
  const cfg = join(dir, 'answers.json');
  writeFileSync(cfg, JSON.stringify(answers));
  const options = loadOptions(cfg);
  const state = { ...detect(dir), entry: 'src/index.ts' };
  const noopExec = () => {}; // skip install/baseline side effects
  return apply(plan(options, state), { cwd: dir, exec: noopExec });
}

test('greenfield: applies the harness, second run is idempotent', () => {
  const p = tmpProject({ 'package.json': { name: 'fresh' } });
  try {
    const answers = { testFramework: 'jest', guardrails: { fallowRatchet: true, locGuard: true, eslintSeverityStaging: true, coverageFloors: true, ci: false }, github: { integrate: false }, docs: { scaffold: true } };
    setup(p.dir, answers);
    assert.ok(existsSync(join(p.dir, 'eslint.config.mjs')));
    assert.ok(existsSync(join(p.dir, '.fallowrc.json')));
    assert.ok(existsSync(join(p.dir, 'jest.config.mjs')));
    assert.ok(existsSync(join(p.dir, 'docs/quality-integration-guide.md')));
    assert.match(readFileSync(join(p.dir, 'package.json'), 'utf8'), /"check:quality"/);

    const second = setup(p.dir, answers);
    assert.deepEqual(second.changed, []); // fully converged
  } finally {
    p.cleanup();
  }
});

test('brownfield idempotency: install flips detection, but a re-apply stays a no-op', async () => {
  // Adopting TS tooling on a repo that had neither tsconfig nor the dep: the
  // first apply installs `typescript`, which flips detect() from false->true.
  // The second apply must NOT see that flip as a change (it would re-baseline).
  const p = tmpProject({ 'package.json': { name: 'adopts-ts' } });
  try {
    const cfg = join(p.dir, 'answers.json');
    writeFileSync(cfg, JSON.stringify({
      guardrails: { fallowRatchet: true, locGuard: true, eslintSeverityStaging: true, coverageFloors: true, ci: false },
      github: { integrate: false }, docs: { scaffold: false },
    }));
    const exec = (cmd, args) => {
      if (args[0] === 'install') {
        const pkgPath = join(p.dir, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        pkg.devDependencies = { ...pkg.devDependencies, typescript: '5.9.3' };
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      }
    };
    const io = (sink) => ({ cwd: p.dir, exec, stdout: (s) => sink.push(s), stderr: () => {} });
    await cli(['apply', '--config', cfg], io([]));
    assert.equal(detect(p.dir).typescript, true); // install flipped detection

    const out = [];
    await cli(['apply', '--config', cfg], io(out));
    assert.match(out.join(''), /already converged/);
  } finally {
    p.cleanup();
  }
});

test('brownfield: never clobbers an existing eslint config', () => {
  const p = tmpProject({
    'package.json': { name: 'old', scripts: { lint: 'my-own-lint' } },
    'eslint.config.mjs': 'export default [/* mine */];\n',
  });
  try {
    setup(p.dir, { testFramework: 'vitest', guardrails: { eslintSeverityStaging: true }, github: { integrate: false }, docs: { scaffold: false } });
    assert.equal(readFileSync(join(p.dir, 'eslint.config.mjs'), 'utf8'), 'export default [/* mine */];\n'); // skip-if-exists
    assert.equal(JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')).scripts.lint, 'my-own-lint'); // existing script preserved
  } finally {
    p.cleanup();
  }
});
