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
  renderLibraryEmpty,
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

    expect(root.querySelector('.claudian-library-header h2')?.textContent).toBe('Tools');
    expect(renderNav).toHaveBeenCalledWith(root);
    expect(root.querySelector('.nav-marker')).not.toBeNull();
    expect(actions.classList.contains('claudian-library-header-actions')).toBe(true);
    expect(list.classList.contains('claudian-library-list')).toBe(true);
  });

  it('renderLibraryEmpty renders a muted row', () => {
    const root = container();
    renderLibraryEmpty(root, 'Nothing here');
    expect(root.querySelector('.claudian-library-empty')?.textContent).toBe('Nothing here');
  });

  it('createLibraryCard exposes name row, body and actions', () => {
    const root = container();
    const { nameRow, body, actions } = createLibraryCard(root, 'my-tool');
    expect(nameRow.textContent).toBe('my-tool');
    expect(body.classList.contains('claudian-library-card-body')).toBe(true);
    expect(actions.classList.contains('claudian-library-card-actions')).toBe(true);
  });

  it('modal helpers render labels, fields, inputs, code areas and footer', () => {
    const root = container();
    renderModalLabel(root, 'Source');
    renderModalField(root, 'Name', 'value');
    const input = renderModalTextField(root, 'Rename', 'old');
    const code = createModalCodeArea(root, 'const x = 1;');

    expect(root.querySelector('.claudian-library-modal-label')?.textContent).toBe('Source');
    expect(root.querySelector('.claudian-library-modal-value')?.textContent).toBe('value');
    expect(input.value).toBe('old');
    expect(code.value).toBe('const x = 1;');
    expect(code.spellcheck).toBe(false);

    const onSave = jest.fn();
    const onClose = jest.fn();
    renderModalFooter(root, { saveLabel: 'Save', onSave, closeLabel: 'Close', onClose });
    const buttons = Array.from(root.querySelectorAll('.claudian-library-modal-footer button')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    buttons[0].click();
    buttons[1].click();
    expect(onSave).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renderModalFooter omits Save when no handler is given', () => {
    const root = container();
    renderModalFooter(root, { closeLabel: 'Close', onClose: jest.fn() });
    expect(root.querySelectorAll('.claudian-library-modal-footer button')).toHaveLength(1);
  });
});
