/**
 * @jest-environment jsdom
 */
import '../../setup/obsidianDom';

import { LIBRARY_VIEW_TYPES, renderLibraryNav } from '@/shared/libraryNav';

describe('renderLibraryNav', () => {
  it('renders the library views, highlights the active one, and wires the others', () => {
    const root = document.createElement('div');
    const host = { openLeafView: jest.fn(async () => {}) };

    renderLibraryNav(root, host, LIBRARY_VIEW_TYPES.skills);

    const items = Array.from(root.querySelectorAll('.claudian-library-nav-item')) as HTMLButtonElement[];
    expect(items).toHaveLength(4);

    const active = root.querySelector('.claudian-library-nav-item.is-active');
    expect(active?.textContent).toBe('Skills');

    // The active item has no click handler; an inactive one navigates.
    items[0].click();
    expect(host.openLeafView).toHaveBeenCalledWith(LIBRARY_VIEW_TYPES.agents);
  });
});
