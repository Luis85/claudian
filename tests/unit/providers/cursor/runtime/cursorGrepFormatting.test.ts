import {
  type CursorGrepValueCoercions,
  formatCursorGrepSuccess,
} from '@/providers/cursor/runtime/cursorGrepFormatting';

// Mirror the coercions cursorToolNormalization passes in.
const coerce: CursorGrepValueCoercions = {
  stringValue: (value) => (typeof value === 'string' ? value : ''),
  numericValue: (value) => (typeof value === 'number' ? value : null),
};

describe('formatCursorGrepSuccess', () => {
  it('returns empty when workspaceResults is missing or not an object', () => {
    expect(formatCursorGrepSuccess({}, coerce)).toBe('');
    expect(formatCursorGrepSuccess({ workspaceResults: 'nope' }, coerce)).toBe('');
  });

  it('formats a single workspace without a name prefix', () => {
    const out = formatCursorGrepSuccess({
      workspaceResults: {
        '/repo': {
          content: {
            totalLines: 10,
            totalMatchedLines: 2,
            matches: [
              { file: 'a.ts', line: 3, text: 'hit one' },
              { file: 'b.ts', line: 7, text: 'hit two' },
            ],
          },
        },
      },
    }, coerce);
    expect(out).toBe('2 matches across 10 lines\na.ts:3: hit one\nb.ts:7: hit two');
  });

  it('prefixes each summary with the workspace name when multiple are present', () => {
    const out = formatCursorGrepSuccess({
      workspaceResults: {
        '/one': { content: { totalLines: 1, totalMatchedLines: 1, matches: [{ file: 'a.ts', line: 1, text: 'x' }] } },
        '/two': { content: { totalLines: 2, totalMatchedLines: 0, matches: [] } },
      },
    }, coerce);
    expect(out).toContain('[/one] 1 matches across 1 lines');
    expect(out).toContain('[/two] 0 matches across 2 lines');
  });

  it('skips workspaces whose payload or content is missing', () => {
    const out = formatCursorGrepSuccess({
      workspaceResults: {
        '/null': null,
        '/no-content': { notContent: {} },
        '/ok': { content: { totalLines: 5, totalMatchedLines: 1, matches: [] } },
      },
    }, coerce);
    // Only the valid workspace contributes a line (single effective summary, no prefix logic asserted here).
    expect(out).toContain('1 matches across 5 lines');
    expect(out).not.toContain('/null');
  });

  it('drops an empty file/line prefix and skips non-object matches', () => {
    const out = formatCursorGrepSuccess({
      workspaceResults: {
        '/repo': {
          content: {
            totalLines: 3,
            totalMatchedLines: 2,
            matches: ['not-an-object', { text: 'bare text' }],
          },
        },
      },
    }, coerce);
    expect(out).toBe('2 matches across 3 lines\nbare text');
  });

  it('defaults missing counts to 0 and ignores non-array matches', () => {
    const out = formatCursorGrepSuccess({
      workspaceResults: { '/repo': { content: { matches: 'not-array' } } },
    }, coerce);
    expect(out).toBe('0 matches across 0 lines');
  });
});
