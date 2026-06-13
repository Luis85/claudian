import * as fs from 'fs';
import * as path from 'path';

/**
 * Durable a11y + reduced-motion guard for the Agent Board redesign (slice 14).
 *
 * This is the reproducible regression net behind the one-off audit
 * (`docs/reviews/2026-06-07-agent-board-redesign-a11y-audit.md`). It locks two
 * invariants in source so a future edit can't silently regress them:
 *
 *  1. Reduced motion — every `animation:` declaration in `agent-board.css` and
 *     `work-order-modal.css` lives inside a `@media (prefers-reduced-motion:
 *     no-preference)` block, so a user who asks for reduced motion gets the
 *     non-motion visuals (color / glyph / layout) with the pulse suppressed.
 *     `@keyframes` blocks are inert until referenced by an `animation:` and so
 *     are deliberately excluded from the scan.
 *
 *  2. ARIA presence — the critical roles/states the redesign relies on exist in
 *     the renderer/modal/portal source: the Auto-run `role="switch"` +
 *     `aria-checked`, the portal `role="menu"` / `role="menuitem"`, the lane and
 *     modal-section `aria-expanded`, and the acceptance-checklist
 *     `role="checkbox"` + `aria-checked`.
 *
 * Reproduce the reduced-motion check by hand (should print nothing):
 *
 *   rg -n 'animation:' src/style/features/agent-board.css src/style/features/work-order-modal.css \
 *     | rg -v 'keyframes'   # then confirm each hit is inside a prefers-reduced-motion block
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

const CSS_FILES = [
  'src/style/features/agent-board.css',
  'src/style/features/work-order-modal.css',
];

interface AnimationDecl {
  file: string;
  line: number;
  insideReducedMotion: boolean;
  insideKeyframes: boolean;
  text: string;
}

interface ScanPos {
  index: number;
  line: number;
}

/** Skip a `/* *\/` block comment starting at `i` (CSS has no line comments). */
function skipBlockComment(source: string, i: number, line: number): ScanPos {
  i += 2;
  while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
    if (source[i] === '\n') line += 1;
    i += 1;
  }
  return { index: i + 2, line };
}

/**
 * Read a string literal starting at the opening quote `i`, returning the new
 * position and the consumed text (so a `{`/`}`/`;` inside it stays inert while
 * the quoted value still lands in the current declaration prelude).
 */
function readStringLiteral(
  source: string,
  i: number,
  line: number,
): ScanPos & { text: string } {
  const quote = source[i];
  let text = quote;
  i += 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') {
      text += source[i] + (source[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (source[i] === '\n') line += 1;
    text += source[i];
    i += 1;
  }
  if (i < source.length) {
    text += source[i];
    i += 1;
  }
  return { index: i, line, text };
}

/**
 * Walk a stylesheet character by character tracking brace depth. For each `{`
 * we record what kind of block it opens (a `@media (prefers-reduced-motion:
 * no-preference)` block, a `@keyframes` block, or any other rule). For every
 * `animation:` property declaration we capture whether ANY enclosing block on
 * the stack is a reduced-motion media block and whether ANY enclosing block is
 * a `@keyframes` block. Comments and strings are skipped so a `{` inside either
 * cannot corrupt the depth count.
 *
 * This is robust to nesting order: an `animation:` is only "gated" when a
 * reduced-motion media block is an ancestor on the stack at the point of the
 * declaration — exactly the property we want to assert.
 */
function findAnimationDeclarations(file: string, source: string): AnimationDecl[] {
  type Frame = { reducedMotion: boolean; keyframes: boolean };
  const stack: Frame[] = [];
  const decls: AnimationDecl[] = [];

  let i = 0;
  let line = 1;
  const isReducedMotionSelector = (selector: string): boolean =>
    /@media[^{]*prefers-reduced-motion\s*:\s*no-preference/.test(selector);
  const isKeyframesSelector = (selector: string): boolean => /@(?:-\w+-)?keyframes\b/.test(selector);

  // Tracks the text since the last `{`/`}`/`;` — i.e. the current selector
  // prelude when we hit a `{`, or the current declaration when we hit a `;`.
  let pending = '';

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '\n') {
      line += 1;
      pending += ch;
      i += 1;
      continue;
    }

    // Skip block comments wholesale (CSS has no line comments).
    if (ch === '/' && next === '*') {
      ({ index: i, line } = skipBlockComment(source, i, line));
      continue;
    }

    // Skip string literals so a `{`/`}`/`;` inside a quoted value is inert.
    if (ch === '"' || ch === "'") {
      const result = readStringLiteral(source, i, line);
      pending += result.text;
      i = result.index;
      line = result.line;
      continue;
    }

    if (ch === '{') {
      const selector = pending;
      stack.push({
        reducedMotion: isReducedMotionSelector(selector),
        keyframes: isKeyframesSelector(selector),
      });
      pending = '';
      i += 1;
      continue;
    }

    if (ch === '}') {
      stack.pop();
      pending = '';
      i += 1;
      continue;
    }

    if (ch === ';') {
      const decl = pending.trim();
      if (/(?:^|\s)animation\s*:/.test(decl)) {
        decls.push({
          file,
          line,
          insideReducedMotion: stack.some((f) => f.reducedMotion),
          insideKeyframes: stack.some((f) => f.keyframes),
          text: decl,
        });
      }
      pending = '';
      i += 1;
      continue;
    }

    pending += ch;
    i += 1;
  }

  return decls;
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('Agent Board reduced-motion CSS gating', () => {
  const allDecls: AnimationDecl[] = [];
  for (const rel of CSS_FILES) {
    allDecls.push(...findAnimationDeclarations(rel, readSource(rel)));
  }

  it('locates the expected pulse animations (parser sanity check)', () => {
    // agent-board.css: dot-pulse + live-strip pulse. work-order-modal.css:
    // header live-dot pulse. All three are `animation:` properties (NOT the
    // `@keyframes` definitions, which the parser flags separately).
    const propertyDecls = allDecls.filter((d) => !d.insideKeyframes);
    expect(propertyDecls.length).toBe(3);
  });

  it('gates every `animation:` property behind prefers-reduced-motion: no-preference', () => {
    const ungated = allDecls
      .filter((d) => !d.insideKeyframes && !d.insideReducedMotion)
      .map((d) => `${d.file}:${d.line}  ${d.text}`);
    expect(ungated).toEqual([]);
  });
});

describe('Agent Board critical ARIA attributes are present in source', () => {
  // Each entry: a source file + the substrings that MUST appear in it. The
  // checks are intentionally coarse (presence, not position) — the behavioral
  // assertions live in the jsdom renderer/modal specs; this is the cheap
  // tripwire that catches an attribute being deleted outright.
  const cases: ReadonlyArray<{ file: string; needles: string[] }> = [
    {
      // Auto-run switch + ⋯ overflow trigger + lane toggles.
      file: 'src/features/tasks/ui/AgentBoardRenderer.ts',
      needles: [
        "role: 'switch'",
        "'aria-checked'",
        "'aria-expanded'",
        "'aria-haspopup': 'menu'",
        "setAttribute('tabindex', '0')",
      ],
    },
    {
      // Portal overflow menu container + items.
      file: 'src/features/tasks/ui/portalPopover.ts',
      needles: ["'role', 'menu'", "'role', 'menuitem'"],
    },
    {
      // Modal collapsible sections (aria-expanded) + read-only acceptance
      // checklist (role=checkbox + aria-checked).
      file: 'src/features/tasks/ui/WorkOrderDetailModal.ts',
      needles: ["'aria-expanded'", "'role', 'checkbox'", "'aria-checked'"],
    },
  ];

  it.each(cases)('$file declares its required ARIA hooks', ({ file, needles }) => {
    const source = readSource(file);
    const missing = needles.filter((needle) => !source.includes(needle));
    expect(missing).toEqual([]);
  });
});
