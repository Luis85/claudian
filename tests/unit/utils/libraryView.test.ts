/**
 * @jest-environment jsdom
 */
import '../../setup/obsidianDom';

import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import {
  createLibraryCard,
  createModalCodeArea,
  librarySlug,
  renameLibraryItemDir,
  renderLibraryEmptyState,
  renderLibraryShell,
  renderModalField,
  renderModalFooter,
  renderModalLabel,
  renderModalTextField,
  uniqueChildDir,
} from '@/utils/libraryView';

function makeAdapter(files: Record<string, string>) {
  return {
    exists: jest.fn(async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`))),
    read: jest.fn(async (p: string) => files[p]),
    write: jest.fn(async (p: string, c: string) => { files[p] = c; }),
    delete: jest.fn(async (p: string) => { delete files[p]; }),
    deleteFolder: jest.fn(async () => {}),
  } as unknown as VaultFileAdapter;
}

function container(): HTMLElement {
  return document.createElement('div');
}

describe('librarySlug', () => {
  it('lowercases and dashes non-alphanumerics, trimming edges', () => {
    expect(librarySlug('My Cool Tool!')).toBe('my-cool-tool');
    expect(librarySlug('  --A__B--  ')).toBe('a-b');
    expect(librarySlug('???')).toBe('');
  });
});

describe('uniqueChildDir', () => {
  it('returns the base dir when free', async () => {
    expect(await uniqueChildDir(makeAdapter({}), '.x/tools', 'foo')).toBe('.x/tools/foo');
  });

  it('suffixes -2, -3 when taken', async () => {
    const adapter = makeAdapter({ '.x/tools/foo/tool.ts': '', '.x/tools/foo-2/tool.ts': '' });
    expect(await uniqueChildDir(adapter, '.x/tools', 'foo')).toBe('.x/tools/foo-3');
  });

  it('falls back to "item" for an empty slug', async () => {
    expect(await uniqueChildDir(makeAdapter({}), '.x/tools', '')).toBe('.x/tools/item');
  });
});

describe('renameLibraryItemDir', () => {
  it('moves the file into a fresh dir and removes the old one', async () => {
    const files: Record<string, string> = { '.x/skills/old/SKILL.md': 'body' };
    const adapter = makeAdapter(files);

    const newPath = await renameLibraryItemDir(adapter, '.x/skills/old/SKILL.md', '.x/skills', 'new', 'updated');

    expect(newPath).toBe('.x/skills/new/SKILL.md');
    expect(files['.x/skills/new/SKILL.md']).toBe('updated');
    expect(adapter.delete).toHaveBeenCalledWith('.x/skills/old/SKILL.md');
    expect(adapter.deleteFolder).toHaveBeenCalledWith('.x/skills/old');
  });

  it('does not delete when the resolved path equals the old path', async () => {
    const files: Record<string, string> = {};
    const adapter = makeAdapter(files);

    const newPath = await renameLibraryItemDir(adapter, '.x/skills/keep/SKILL.md', '.x/skills', 'keep', 'body');

    expect(newPath).toBe('.x/skills/keep/SKILL.md');
    expect(adapter.delete).not.toHaveBeenCalled();
  });
});

describe('DOM helpers', () => {
  it('renderLibraryShell builds header + list and runs the optional nav renderer', () => {
    const root = container();
    const renderNav = jest.fn((c: HTMLElement) => c.createDiv({ cls: 'nav-marker' }));
    const { actions, list } = renderLibraryShell(root, 'Tools', renderNav);

    expect(root.querySelector('.specorator-library-header h2')?.textContent).toBe('Tools');
    expect(renderNav).toHaveBeenCalledWith(root);
    expect(root.querySelector('.nav-marker')).not.toBeNull();
    expect(actions.classList.contains('specorator-library-header-actions')).toBe(true);
    expect(list.classList.contains('specorator-library-list')).toBe(true);
  });

  it('renderLibraryEmptyState renders the message and a working CTA', () => {
    const root = container();
    const onAction = jest.fn();
    renderLibraryEmptyState(root, { icon: 'wrench', message: 'Nothing here', actionLabel: 'New tool', onAction });

    expect(root.querySelector('.specorator-library-empty-icon')).not.toBeNull();
    expect(root.querySelector('.specorator-library-empty-text')?.textContent).toBe('Nothing here');
    const btn = root.querySelector<HTMLButtonElement>('.specorator-library-empty-action');
    expect(btn?.textContent).toBe('New tool');
    btn?.click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renderLibraryEmptyState omits the CTA when no action is given', () => {
    const root = container();
    renderLibraryEmptyState(root, { icon: 'book-open', message: 'Empty' });
    expect(root.querySelector('.specorator-library-empty-action')).toBeNull();
  });

  it('createLibraryCard exposes card, name row, body and actions', () => {
    const root = container();
    const { card, nameRow, body, actions, nameButton } = createLibraryCard(root, 'my-tool');
    expect(card.classList.contains('specorator-library-card')).toBe(true);
    expect(nameRow.textContent).toBe('my-tool');
    // Default name is a plain span — no focusable button.
    expect(nameRow.querySelector('button')).toBeNull();
    expect(nameButton).toBeUndefined();
    expect(body.classList.contains('specorator-library-card-body')).toBe(true);
    expect(actions.classList.contains('specorator-library-card-actions')).toBe(true);
    expect(root.querySelector('.specorator-library-card-leading')).toBeNull();
  });

  it('createLibraryCard renders a leading slot and a focusable name button when asked', () => {
    const root = container();
    const seedLeading = jest.fn((slot: HTMLElement) => slot.createDiv({ cls: 'avatar-marker' }));
    const { card, nameButton } = createLibraryCard(root, 'Agent', { leading: seedLeading, nameAsButton: true });

    const leading = card.querySelector('.specorator-library-card-leading');
    expect(leading).not.toBeNull();
    expect(seedLeading).toHaveBeenCalledWith(leading);
    expect(leading?.querySelector('.avatar-marker')).not.toBeNull();
    // The leading slot precedes the body so the avatar reads first.
    expect(card.firstElementChild).toBe(leading);

    expect(nameButton?.tagName).toBe('BUTTON');
    expect(nameButton?.textContent).toBe('Agent');
    expect(nameButton?.classList.contains('specorator-library-card-name-button')).toBe(true);
  });

  it('modal helpers render labels, fields, inputs, code areas and footer', () => {
    const root = container();
    renderModalLabel(root, 'Source');
    renderModalField(root, 'Name', 'value');
    const input = renderModalTextField(root, 'Rename', 'old');
    const code = createModalCodeArea(root, 'const x = 1;', 'Source');

    expect(root.querySelector('.specorator-library-modal-label')?.textContent).toBe('Source');
    expect(root.querySelector('.specorator-library-modal-value')?.textContent).toBe('value');
    expect(input.value).toBe('old');
    expect(input.getAttribute('aria-label')).toBe('Rename');
    expect(code.value).toBe('const x = 1;');
    expect(code.getAttribute('aria-label')).toBe('Source');
    expect(code.spellcheck).toBe(false);

    const onSave = jest.fn();
    const onClose = jest.fn();
    renderModalFooter(root, { saveLabel: 'Save', onSave, closeLabel: 'Close', onClose });
    const buttons = Array.from(root.querySelectorAll('.specorator-library-modal-footer button')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    buttons[0].click();
    buttons[1].click();
    expect(onSave).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renderModalFooter omits Save when no handler is given', () => {
    const root = container();
    renderModalFooter(root, { closeLabel: 'Close', onClose: jest.fn() });
    expect(root.querySelectorAll('.specorator-library-modal-footer button')).toHaveLength(1);
  });
});
