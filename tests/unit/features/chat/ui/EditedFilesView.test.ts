import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { EditedFilesView } from '@/features/chat/ui/EditedFilesView';
import type { EditedFileEntry } from '@/features/chat/utils/editedFiles';

jest.mock('obsidian', () => ({ setIcon: jest.fn() }));
jest.mock('@/i18n/i18n', () => ({ t: (key: string) => key }));

function findAll(root: MockElement, cls: string): MockElement[] {
  const out: MockElement[] = [];
  const walk = (n: MockElement) => {
    if (n.hasClass(cls)) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

const entries: EditedFileEntry[] = [
  { path: 'src/new.ts', changeKind: 'created' },
  { path: 'notes/old.md', changeKind: 'edited' },
];

describe('EditedFilesView', () => {
  it('starts hidden', () => {
    const row = createMockEl();
    new EditedFilesView(row, { onOpenFile: jest.fn() });
    expect(row.hasClass('claudian-hidden')).toBe(true);
  });

  it('renders a chip per entry with created/edited modifiers and a label', () => {
    const row = createMockEl();
    const view = new EditedFilesView(row, { onOpenFile: jest.fn() });

    view.render(entries);

    expect(findAll(row, 'claudian-edited-file-chip')).toHaveLength(2);
    expect(findAll(row, 'claudian-edited-file-chip--created')).toHaveLength(1);
    expect(findAll(row, 'claudian-edited-file-chip--edited')).toHaveLength(1);
    expect(findAll(row, 'claudian-edited-files-label')).toHaveLength(1);
    expect(row.hasClass('claudian-visible-flex')).toBe(true);
    expect(row.hasClass('claudian-hidden')).toBe(false);
  });

  it('hides and clears the row when there are no entries', () => {
    const row = createMockEl();
    const view = new EditedFilesView(row, { onOpenFile: jest.fn() });
    view.render(entries);

    view.render([]);

    expect(findAll(row, 'claudian-edited-file-chip')).toHaveLength(0);
    expect(row.hasClass('claudian-hidden')).toBe(true);
    expect(row.hasClass('claudian-visible-flex')).toBe(false);
  });

  it('opens the file on chip click', () => {
    const row = createMockEl();
    const onOpenFile = jest.fn();
    const view = new EditedFilesView(row, { onOpenFile });
    view.render(entries);

    findAll(row, 'claudian-edited-file-chip')[0].click();

    expect(onOpenFile).toHaveBeenCalledWith('src/new.ts');
  });
});
