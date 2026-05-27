import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { renderMessageContextCard } from '@/features/chat/rendering/MessageContextCard';

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

describe('renderMessageContextCard', () => {
  it('returns null and renders nothing when there is no context', () => {
    const container = createMockEl();
    const card = renderMessageContextCard(container, { files: [], folders: [] });
    expect(card).toBeNull();
    expect(findAll(container, 'claudian-context-card')).toHaveLength(0);
  });

  it('renders a row per file and folder with a total count', () => {
    const container = createMockEl();
    renderMessageContextCard(container, {
      files: ['notes.md', 'src/api.ts'],
      folders: ['src/providers'],
    });

    expect(findAll(container, 'claudian-context-card')).toHaveLength(1);
    expect(findAll(container, 'claudian-context-card-row')).toHaveLength(3);
    expect(findAll(container, 'claudian-context-card-row--folder')).toHaveLength(1);

    const label = findAll(container, 'claudian-context-card-header-label')[0];
    expect(label.textContent).toBe('Attached context (3)');

    const names = findAll(container, 'claudian-context-card-row-name').map((n) => n.textContent);
    expect(names).toEqual(['notes.md', 'api.ts', 'providers/']);
  });

  it('invokes onOpenFile when a file row is clicked', () => {
    const container = createMockEl();
    const onOpenFile = jest.fn();
    renderMessageContextCard(container, { files: ['notes.md'], folders: [] }, { onOpenFile });

    const row = findAll(container, 'claudian-context-card-row--file')[0];
    expect(row.hasClass('claudian-context-card-row--clickable')).toBe(true);
    row.dispatchEvent(new Event('click'));
    expect(onOpenFile).toHaveBeenCalledWith('notes.md');
  });
});
