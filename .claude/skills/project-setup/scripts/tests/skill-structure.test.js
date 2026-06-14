// scripts/tests/skill-structure.test.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('SKILL.md has name + description frontmatter', () => {
  const md = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
  assert.match(md, /^---/);
  assert.match(md, /name:\s*project-setup/);
  assert.match(md, /description:\s*.+/);
});

test('all four reference docs exist', () => {
  for (const ref of ['quality-harness.md', 'docs-taxonomy.md', 'grill.md', 'github-integration.md']) {
    assert.ok(existsSync(join(SKILL_ROOT, 'references', ref)), `missing references/${ref}`);
  }
});
