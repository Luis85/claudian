// scripts/tests/templates.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadTemplate, renderTemplate } from '../lib/templates.mjs';

test('renderTemplate substitutes {{tokens}} and throws on a missing var', () => {
  assert.equal(renderTemplate('a {{x}} b', { x: 1 }), 'a 1 b');
  assert.throws(() => renderTemplate('{{missing}}', {}), /Template variable not provided: missing/);
});

test('loadTemplate reads a bundled template verbatim', () => {
  assert.match(loadTemplate('_smoke.tmpl'), /smoke {{name}}/);
});
