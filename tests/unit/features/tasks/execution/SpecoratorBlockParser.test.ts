import { SpecoratorBlockParser } from '../../../../../src/features/tasks/execution/SpecoratorBlockParser';

describe('SpecoratorBlockParser', () => {
  it('extracts a single progress block', () => {
    const parser = new SpecoratorBlockParser();
    const out = parser.feed('Hello <specorator_progress>\nstep: doing thing\ndone: 1/3\n</specorator_progress> world');
    expect(out.plainText).toBe('Hello  world');
    expect(out.blocks).toEqual([
      { kind: 'progress', fields: { step: 'doing thing', done: '1/3' }, raw: expect.any(String) },
    ]);
  });

  it('handles a block split across two chunks', () => {
    const parser = new SpecoratorBlockParser();
    const a = parser.feed('text <specorator_needs_input>\nquestion: which env');
    const b = parser.feed(' file?\nwhy: ambiguous\n</specorator_needs_input> tail');
    expect(a.blocks).toEqual([]);
    expect(b.blocks).toEqual([
      { kind: 'needs_input', fields: { question: 'which env file?', why: 'ambiguous' }, raw: expect.any(String) },
    ]);
    expect(a.plainText + b.plainText).toBe('text  tail');
  });

  it('reports malformed block via warning array when a required field is missing', () => {
    const parser = new SpecoratorBlockParser();
    const out = parser.feed('<specorator_needs_input>\nwhy: no question\n</specorator_needs_input>');
    expect(out.blocks).toEqual([]);
    expect(out.warnings).toEqual(['needs_input missing required field: question']);
  });

  it('strips unknown fields silently in known blocks', () => {
    const parser = new SpecoratorBlockParser();
    const out = parser.feed('<specorator_progress>\nstep: x\nfuture: y\n</specorator_progress>');
    expect(out.blocks).toEqual([
      { kind: 'progress', fields: { step: 'x' }, raw: expect.any(String) },
    ]);
    expect(out.warnings).toEqual([]);
  });

  it('emits multiple blocks in order', () => {
    const parser = new SpecoratorBlockParser();
    const out = parser.feed(
      'A <specorator_progress>\nstep: one\n</specorator_progress> B <specorator_progress>\nstep: two\n</specorator_progress> C',
    );
    expect(out.blocks.map((b) => b.fields.step)).toEqual(['one', 'two']);
    expect(out.plainText).toBe('A  B  C');
  });

  it('drops unclosed block at end of stream when finalize called', () => {
    const parser = new SpecoratorBlockParser();
    parser.feed('<specorator_progress>\nstep: half');
    const out = parser.finalize();
    expect(out.blocks).toEqual([]);
    expect(out.warnings).toEqual(['progress block was not closed before stream end']);
  });

  it('closes a block whose closing tag is split across chunks', () => {
    const parser = new SpecoratorBlockParser();
    const a = parser.feed('<specorator_needs_input>\nquestion: which?\n</specorator_needs_in');
    const b = parser.feed('put> tail');
    expect(a.blocks).toEqual([]);
    expect(a.warnings).toEqual([]);
    expect(b.blocks).toEqual([
      { kind: 'needs_input', fields: { question: 'which?' }, raw: expect.any(String) },
    ]);
    expect(b.plainText).toBe(' tail');
  });

  it('closes a block when the closing tag is split one character at a time', () => {
    const parser = new SpecoratorBlockParser();
    let blocks: ReturnType<SpecoratorBlockParser['feed']>['blocks'] = [];
    for (const ch of '<specorator_progress>\nstep: x\n</specorator_progress>'.split('')) {
      const out = parser.feed(ch);
      blocks = blocks.concat(out.blocks);
    }
    expect(blocks).toEqual([
      { kind: 'progress', fields: { step: 'x' }, raw: expect.any(String) },
    ]);
    expect(parser.finalize().warnings).toEqual([]);
  });

  it('does not strand a block on a coincidental partial-close-tag prefix in the body', () => {
    const parser = new SpecoratorBlockParser();
    // The body text starts like the close tag but does not complete it.
    const a = parser.feed('<specorator_progress>\nstep: see </specorator_progres');
    const b = parser.feed('sion notes\n</specorator_progress>');
    expect(a.blocks).toEqual([]);
    expect(b.blocks).toEqual([
      { kind: 'progress', fields: { step: 'see </specorator_progression notes' }, raw: expect.any(String) },
    ]);
    expect(b.warnings).toEqual([]);
  });
});
