import { LoopNoteStore } from '../../../../../src/features/tasks/loops/LoopNoteStore';

const store = new LoopNoteStore();

const VALID = `---
type: claudian-loop
schema_version: 1
name: "Reproduce then fix"
description: "Tight bug-fix loop."
icon: bug
---
## Use when

A defect is reproducible.

## Approach

Reproduce, isolate, fix narrowly, prove it.

## Steps

1. Reproduce.
2. Fix.

## Verify

The failing check passes.

## Notes

Do not refactor adjacent code.
`;

describe('LoopNoteStore.parse', () => {
  it('parses frontmatter and all body sections', () => {
    const loop = store.parse('Agent Board/loops/reproduce-then-fix.md', VALID);
    expect(loop.id).toBe('reproduce-then-fix');
    expect(loop.name).toBe('Reproduce then fix');
    expect(loop.description).toBe('Tight bug-fix loop.');
    expect(loop.icon).toBe('bug');
    expect(loop.useWhen).toBe('A defect is reproducible.');
    expect(loop.approach).toBe('Reproduce, isolate, fix narrowly, prove it.');
    expect(loop.steps).toBe('1. Reproduce.\n2. Fix.');
    expect(loop.verify).toBe('The failing check passes.');
    expect(loop.notes).toBe('Do not refactor adjacent code.');
  });

  it('rejects a wrong type', () => {
    const bad = VALID.replace('claudian-loop', 'something-else');
    expect(() => store.parse('x.md', bad)).toThrow('Invalid loop type');
  });

  it('rejects an unsupported schema_version', () => {
    const bad = VALID.replace('schema_version: 1', 'schema_version: 2');
    expect(() => store.parse('x.md', bad)).toThrow('Unsupported loop schema_version');
  });

  it('tolerates missing optional sections', () => {
    const minimal = `---
type: claudian-loop
schema_version: 1
name: "Only approach"
---
## Approach

Just do the thing.
`;
    const loop = store.parse('Agent Board/loops/only-approach.md', minimal);
    expect(loop.approach).toBe('Just do the thing.');
    expect(loop.useWhen).toBe('');
    expect(loop.steps).toBe('');
    expect(loop.verify).toBe('');
    expect(loop.notes).toBe('');
    expect(loop.description).toBeUndefined();
  });
});

describe('LoopNoteStore.build', () => {
  it('round-trips through parse', () => {
    const md = store.build({
      name: 'Reproduce then fix',
      description: 'Tight bug-fix loop.',
      icon: 'bug',
      useWhen: 'A defect is reproducible.',
      approach: 'Reproduce, isolate, fix narrowly, prove it.',
      steps: '1. Reproduce.\n2. Fix.',
      verify: 'The failing check passes.',
      notes: 'Do not refactor adjacent code.',
    });
    const loop = store.parse('Agent Board/loops/reproduce-then-fix.md', md);
    expect(loop.name).toBe('Reproduce then fix');
    expect(loop.approach).toBe('Reproduce, isolate, fix narrowly, prove it.');
    expect(loop.notes).toBe('Do not refactor adjacent code.');
  });
});
