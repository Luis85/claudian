import * as fs from 'fs';
import * as path from 'path';

/**
 * Airtight i18n guard for the Agent Board / agents UI (redesign slice 13).
 *
 * Every user-visible string that reaches a render sink must resolve through the
 * i18n helper `t(...)`, never a raw string literal. After the sweep, every such
 * call reads `setText(t('…'))` / `text: t('…')`, so the character immediately
 * after the sink's `(` or `:` is `t`, not a quote. This test asserts that
 * invariant directly: the forbidden patterns below must have ZERO matches.
 *
 * Reproduce by hand (one line) — should print nothing:
 *
 *   rg -n -e "\bsetText\(\s*['\"]" -e "\bsetTooltip\(\s*['\"]" -e "\.setName\(\s*['\"]" -e "\.setDesc\(\s*['\"]" -e "\.setButtonText\(\s*['\"]" -e "\.setTitle\(\s*['\"]" -e "\bsetPlaceholder\(\s*['\"]" -e "\btext:\s*['\"]" -e "\bplaceholder:\s*['\"]" -e "setAttribute\(\s*['\"](aria-label|title)['\"]\s*,\s*['\"]" -e "['\"]aria-label['\"]\s*:\s*['\"]" src/features/tasks/ui/ src/features/agents/
 *
 * Decorative, non-linguistic glyphs (e.g. a chevron or em-dash placeholder) are
 * NOT keyed — they live in CSS `::before` content, so no JS literal reaches a
 * sink. Genuinely dynamic values built with template literals (backticks, e.g.
 * `${done}/${total}`) are not flagged: the invariant only forbids a single/double
 * quote, which a value-only interpolation never uses right after the sink.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');

const SCANNED_DIRS = ['src/features/tasks/ui', 'src/features/agents'];

/**
 * Sinks that paint user-visible text. Each entry's regex matches the sink
 * followed by an opening quote — exactly the shape a raw literal produces and
 * a `t(...)` call does not.
 */
const FORBIDDEN_SINKS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'setText(<literal>)', pattern: /\bsetText\(\s*['"]/ },
  { name: 'setTooltip(<literal>)', pattern: /\bsetTooltip\(\s*['"]/ },
  { name: '.setName(<literal>)', pattern: /\.setName\(\s*['"]/ },
  { name: '.setDesc(<literal>)', pattern: /\.setDesc\(\s*['"]/ },
  { name: '.setButtonText(<literal>)', pattern: /\.setButtonText\(\s*['"]/ },
  { name: '.setTitle(<literal>)', pattern: /\.setTitle\(\s*['"]/ },
  { name: 'setPlaceholder(<literal>)', pattern: /\bsetPlaceholder\(\s*['"]/ },
  // createEl/createDiv/... `{ text: 'literal' }` and `{ placeholder: 'literal' }`.
  { name: 'text: <literal>', pattern: /\btext:\s*['"]/ },
  { name: 'placeholder: <literal>', pattern: /\bplaceholder:\s*['"]/ },
  // setAttribute('aria-label' | 'title', 'literal') and { 'aria-label': 'literal' }.
  { name: "setAttribute('aria-label' | 'title', <literal>)", pattern: /setAttribute\(\s*['"](?:aria-label|title)['"]\s*,\s*['"]/ },
  { name: "{ 'aria-label': <literal> } / { 'title': <literal> }", pattern: /['"](?:aria-label|title)['"]\s*:\s*['"]/ },
  // Direct DOM text/label assignment with a literal.
  { name: '.textContent = <literal>', pattern: /\.textContent\s*=\s*['"]/ },
];

/**
 * Allowlist of `dir/file.ts#sink` exceptions. Empty by design — the sweep keys
 * everything and relocates decorative glyphs to CSS. If a future literal is
 * genuinely untranslatable, add `"<relativePath>#<sink name>"` here with a
 * justification comment rather than weakening the patterns above.
 */
const ALLOWLIST = new Set<string>([]);

function collectTsFiles(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(abs));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Strip line comments and block comments so documentation that mentions a sink
 * (e.g. an example in a JSDoc block) never trips the guard. Conservative on
 * strings: it only avoids treating a comment-opener inside a quoted string as a
 * comment by bailing out of comment detection while inside a quote/backtick.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        // Preserve the escaped char verbatim.
        if (i + 1 < source.length) out += source[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

describe('Agent Board UI has no untranslated string literals', () => {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) {
    files.push(...collectTsFiles(path.join(REPO_ROOT, dir)));
  }

  it('scans the expected directories and finds source files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('routes every user-visible sink through t(...) (no raw literal arguments)', () => {
    const violations: string[] = [];

    for (const absFile of files) {
      const rel = path.relative(REPO_ROOT, absFile).split(path.sep).join('/');
      const source = stripComments(fs.readFileSync(absFile, 'utf8'));
      const lines = source.split('\n');

      lines.forEach((line, idx) => {
        for (const sink of FORBIDDEN_SINKS) {
          if (!sink.pattern.test(line)) continue;
          const allowKey = `${rel}#${sink.name}`;
          if (ALLOWLIST.has(allowKey)) continue;
          violations.push(`${rel}:${idx + 1}  [${sink.name}]  ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
