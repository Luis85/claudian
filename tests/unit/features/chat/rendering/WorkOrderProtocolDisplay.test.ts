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
});
