import type { App, Vault } from 'obsidian';
import { TFile } from 'obsidian';

import { LoopNoteStore } from '../../../../../src/features/tasks/loops/LoopNoteStore';

const store = new LoopNoteStore();

const VALID = `---
type: specorator-loop
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
    const bad = VALID.replace('specorator-loop', 'something-else');
    expect(() => store.parse('x.md', bad)).toThrow('Invalid loop type');
  });

  it('rejects an unsupported schema_version', () => {
    const bad = VALID.replace('schema_version: 1', 'schema_version: 2');
    expect(() => store.parse('x.md', bad)).toThrow('Unsupported loop schema_version');
  });

  it('tolerates missing optional sections', () => {
    const minimal = `---
type: specorator-loop
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

const VALID_LOOP = `---
type: specorator-loop
schema_version: 1
name: "My Loop"
---
## Approach

Do the thing.
`;

const WRONG_TYPE_LOOP = `---
type: specorator-work-order
schema_version: 1
---
body
`;

describe('LoopNoteStore.parse id fallback', () => {
  it('uses the file basename for both name and id when frontmatter has no name', () => {
    const noName = `---
type: specorator-loop
schema_version: 1
---
## Approach

Do the thing.
`;
    const loop = new LoopNoteStore().parse('Agent Board/loops/my-loop.md', noName);
    expect(loop.name).toBe('my-loop');
    expect(loop.id).toBe('my-loop');
  });
});

describe('LoopNoteStore.getFilePathForName', () => {
  const s = new LoopNoteStore();

  it('slugifies the name under the folder', () => {
    expect(s.getFilePathForName('Agent Board/loops', 'Bug Fix!')).toBe('Agent Board/loops/bug-fix.md');
  });

  it('falls back to loop when name has no alphanumeric characters', () => {
    expect(s.getFilePathForName('Agent Board/loops', '   ---   ')).toBe('Agent Board/loops/loop.md');
  });

  it('strips leading and trailing slashes from the folder', () => {
    expect(s.getFilePathForName('/Agent Board/loops/', 'Fix')).toBe('Agent Board/loops/fix.md');
  });
});

describe('LoopNoteStore.list', () => {
  it('returns parsed loops sorted by name, warns on malformed notes, and excludes files outside the folder', async () => {
    const byPath: Record<string, string> = {
      'Agent Board/loops/b.md': VALID_LOOP.replace('name: "My Loop"', 'name: "Zebra"'),
      'Agent Board/loops/a.md': VALID_LOOP.replace('name: "My Loop"', 'name: "Apple"'),
      'Agent Board/loops/bad.md': WRONG_TYPE_LOOP,
      'Other/x.md': VALID_LOOP,
    };
    const vault = {
      getMarkdownFiles: () => Object.keys(byPath).map((path) => ({ path })),
      read: async (file: { path: string }) => byPath[file.path],
    } as unknown as Vault;

    const { loops, warnings } = await new LoopNoteStore().list(vault, 'Agent Board/loops');
    expect(loops.map((l) => l.name)).toEqual(['Apple', 'Zebra']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('bad.md');
  });
});

describe('LoopNoteStore.save', () => {
  const INPUT = {
    name: 'Fix',
    useWhen: '',
    approach: 'Do it.',
    steps: '',
    verify: '',
    notes: '',
  };

  it('creates a new note (and its folder) when originalPath is not provided', async () => {
    const created: { path: string; content: string }[] = [];
    const folderCreated: string[] = [];
    const vault = {
      getAbstractFileByPath: jest.fn(() => null),
      createFolder: jest.fn(async (path: string) => { folderCreated.push(path); }),
      create: jest.fn(async (path: string, content: string) => {
        created.push({ path, content });
        return { path };
      }),
      modify: jest.fn(),
    } as unknown as Vault;

    const path = await new LoopNoteStore().save(vault, 'Agent Board/loops', INPUT);

    expect(path).toBe('Agent Board/loops/fix.md');
    expect(created).toHaveLength(1);
    expect(created[0].path).toBe('Agent Board/loops/fix.md');
    expect(created[0].content).toContain('specorator-loop');
    expect(folderCreated).toEqual(['Agent Board/loops']);
    expect(vault.modify).not.toHaveBeenCalled();
  });

  it('modifies the existing note in place when originalPath resolves to a TFile', async () => {
    const file = Object.assign(new TFile(), { path: 'Agent Board/loops/old.md' });
    const vault = {
      getAbstractFileByPath: jest.fn(() => file),
      createFolder: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
    } as unknown as Vault;

    const path = await new LoopNoteStore().save(
      vault,
      'Agent Board/loops',
      INPUT,
      'Agent Board/loops/old.md',
    );

    expect(path).toBe('Agent Board/loops/old.md');
    expect(vault.modify).toHaveBeenCalledTimes(1);
    expect(vault.create).not.toHaveBeenCalled();
  });

  it('creates a new note when originalPath is provided but the file is missing', async () => {
    const vault = {
      getAbstractFileByPath: jest.fn(() => null),
      createFolder: jest.fn(),
      create: jest.fn(async (path: string) => ({ path })),
      modify: jest.fn(),
    } as unknown as Vault;

    const path = await new LoopNoteStore().save(
      vault,
      'Agent Board/loops',
      INPUT,
      'Agent Board/loops/old.md',
    );

    expect(path).toBe('Agent Board/loops/fix.md');
    expect(vault.create).toHaveBeenCalledTimes(1);
    expect(vault.modify).not.toHaveBeenCalled();
  });
});

describe('LoopNoteStore.delete', () => {
  it('trashes the file through app.fileManager when it exists', async () => {
    const file = { path: 'Agent Board/loops/old.md' };
    const trashFile = jest.fn();
    const app = {
      vault: { getAbstractFileByPath: jest.fn(() => file) },
      fileManager: { trashFile },
    } as unknown as App;

    await new LoopNoteStore().delete(app, 'Agent Board/loops/old.md');
    expect(trashFile).toHaveBeenCalledWith(file);
  });

  it('is a no-op when the file does not exist', async () => {
    const trashFile = jest.fn();
    const app = {
      vault: { getAbstractFileByPath: jest.fn(() => null) },
      fileManager: { trashFile },
    } as unknown as App;

    await new LoopNoteStore().delete(app, 'Agent Board/loops/missing.md');
    expect(trashFile).not.toHaveBeenCalled();
  });
});
