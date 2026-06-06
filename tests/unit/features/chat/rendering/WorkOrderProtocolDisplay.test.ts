import { splitWorkOrderProtocolForDisplay } from '../../../../../src/features/chat/rendering/WorkOrderProtocolDisplay';

describe('splitWorkOrderProtocolForDisplay', () => {
  it('splits a progress block out of surrounding markdown', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      'Working on it.\n<claudian_progress>\nstep: scanning\ndone: 1/3\nnote: starting with src/\n</claudian_progress>\nMore text.',
    );
    expect(segments).toEqual([
      { type: 'markdown', content: 'Working on it.' },
      {
        type: 'progress',
        progress: { step: 'scanning', done: { complete: 1, total: 3 }, note: 'starting with src/' },
      },
      { type: 'markdown', content: 'More text.' },
    ]);
  });

  it('splits a needs_input block', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_needs_input>\nquestion: Use TypeScript?\nwhy: package.json is ambiguous\ndefault: yes\n</claudian_needs_input>',
    );
    expect(segments).toEqual([
      {
        type: 'needs_input',
        needsInput: { question: 'Use TypeScript?', why: 'package.json is ambiguous', defaultValue: 'yes' },
      },
    ]);
  });

  it('splits a needs_approval block with reversible flag', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_needs_approval>\naction: rm -rf node_modules\nrisk: rebuild required\nreversible: true\n</claudian_needs_approval>',
    );
    expect(segments).toEqual([
      {
        type: 'needs_approval',
        needsApproval: { action: 'rm -rf node_modules', risk: 'rebuild required', reversible: true },
      },
    ]);
  });

  it('handles multiple progress blocks intermixed with text and a handoff', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_progress>\nstep: a\ndone: 1/2\n</claudian_progress>\n' +
      'midway\n' +
      '<claudian_progress>\nstep: b\ndone: 2/2\n</claudian_progress>\n' +
      '<claudian_handoff>\nsummary: s\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>',
    );
    expect(segments.map((s) => s.type)).toEqual(['progress', 'markdown', 'progress', 'handoff']);
  });

  it('falls back to a single markdown segment when no protocol blocks are present', () => {
    const segments = splitWorkOrderProtocolForDisplay('Just text, no blocks.');
    expect(segments).toEqual([{ type: 'markdown', content: 'Just text, no blocks.' }]);
  });

  it('rejects a malformed handoff block (returns the input as raw markdown)', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_handoff>\nsummary: s\n', // unclosed
    );
    expect(segments).toEqual([
      { type: 'markdown', content: '<claudian_handoff>\nsummary: s\n' },
    ]);
  });

  it('renders an incomplete progress block as raw markdown (does not swallow)', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_progress>\nstep: a\n', // unclosed
    );
    expect(segments).toEqual([
      { type: 'markdown', content: '<claudian_progress>\nstep: a\n' },
    ]);
  });

  it('does not extract protocol blocks inside fenced code blocks', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      'See the format:\n```xml\n<claudian_progress>\nstep: docs\ndone: 1/2\n</claudian_progress>\n```\nDone.',
    );
    // Whole input stays as one markdown segment; no progress segment emitted.
    expect(segments.map((s) => s.type)).toEqual(['markdown']);
  });

  it('does not extract protocol blocks inside tilde-fenced code blocks', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '~~~xml\n<claudian_handoff>\nsummary: s\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>\n~~~',
    );
    expect(segments.map((s) => s.type)).toEqual(['markdown']);
  });

  it('extracts protocol blocks that appear after a closed fenced block', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '```\nignore me\n```\n<claudian_progress>\nstep: real\ndone: 1/1\n</claudian_progress>',
    );
    expect(segments.map((s) => s.type)).toEqual(['markdown', 'progress']);
  });

  it('truncates handoff preview at 160 chars with ellipsis terminator', () => {
    const long = 'word '.repeat(40); // 200 chars
    const segments = splitWorkOrderProtocolForDisplay(
      `<claudian_handoff>\nsummary: ${long}\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>`,
    );
    const handoff = segments.find((s) => s.type === 'handoff');
    expect(handoff).toBeDefined();
    if (handoff?.type !== 'handoff') throw new Error('expected handoff');
    expect(handoff.preview.length).toBeLessThanOrEqual(160);
    expect(handoff.preview.endsWith('…')).toBe(true);
  });

  it('normalizes preview whitespace and keeps short summaries unchanged', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_handoff>\nsummary: short    summary\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>',
    );
    const handoff = segments.find((s) => s.type === 'handoff');
    if (handoff?.type !== 'handoff') throw new Error('expected handoff');
    expect(handoff.preview).toBe('short summary');
  });

  it('renders multiple handoff blocks as separate handoff segments', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_handoff>\nsummary: a\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>\n' +
      '<claudian_handoff>\nsummary: b\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>',
    );
    expect(segments.map((s) => s.type)).toEqual(['handoff', 'handoff']);
  });

  it('treats reversible values other than "true"/"false" as undefined', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_needs_approval>\naction: deploy\nreversible: yes\n</claudian_needs_approval>',
    );
    const seg = segments[0];
    if (seg.type !== 'needs_approval') throw new Error('expected needs_approval');
    expect(seg.needsApproval.reversible).toBeUndefined();
  });

  it('rejects a progress block whose required step field is blank (emits raw markdown)', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_progress>\nstep: \ndone: 1/2\n</claudian_progress>',
    );
    expect(segments).toEqual([
      { type: 'markdown', content: '<claudian_progress>\nstep: \ndone: 1/2\n</claudian_progress>' },
    ]);
  });
});
