import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { FileChipsView } from '@/features/chat/ui/file-context/view/FileChipsView';

jest.mock('obsidian', () => ({ setIcon: jest.fn() }));

function findAll(root: MockElement, cls: string): MockElement[] {
  const out: MockElement[] = [];
  const walk = (n: MockElement) => {
    if (n.hasClass(cls)) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

describe('FileChipsView.renderPills', () => {
  it('renders current-note, file, and folder pills, deduping the current note', () => {
    const container = createMockEl();
    const view = new FileChipsView(container, { onRemove: jest.fn(), onOpenFile: jest.fn() });
    view.renderPills({ currentNote: 'note.md', files: ['note.md', 'a.ts'], folders: ['src'] });
    expect(findAll(container, 'specorator-file-chip')).toHaveLength(3);
    expect(findAll(container, 'specorator-file-chip--current')).toHaveLength(1);
    expect(findAll(container, 'specorator-file-chip--folder')).toHaveLength(1);
  });

  it('hides the tray when empty', () => {
    const container = createMockEl();
    const view = new FileChipsView(container, { onRemove: jest.fn(), onOpenFile: jest.fn() });
    view.renderPills({ currentNote: null, files: [], folders: [] });
    expect(findAll(container, 'specorator-file-chip')).toHaveLength(0);
  });

  it('fires onRemove with the right kind and does not open folders', () => {
    const container = createMockEl();
    const onRemove = jest.fn();
    const onOpenFile = jest.fn();
    const view = new FileChipsView(container, { onRemove, onOpenFile });
    view.renderPills({ currentNote: null, files: ['a.ts'], folders: ['src'] });

    const folderPill = findAll(container, 'specorator-file-chip--folder')[0];
    // Folders have no click-to-open listener; clicking the pill does not open anything.
    folderPill.click();
    expect(onOpenFile).not.toHaveBeenCalled();

    // Clicking the remove button fires onRemove with ('src', 'folder').
    const removeBtn = findAll(folderPill, 'specorator-file-chip-remove')[0];
    removeBtn.click();
    expect(onRemove).toHaveBeenCalledWith('src', 'folder');
  });
});
