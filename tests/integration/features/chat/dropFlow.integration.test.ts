import { createMockEl } from '@test/helpers/mockElement';
import { Notice, TFile } from 'obsidian';

import { ChatDropController } from '@/features/chat/controllers/ChatDropController';
import { FileContextManager } from '@/features/chat/ui/FileContext';
import { ImageContextManager } from '@/features/chat/ui/ImageContext';

function makeApp(externalContexts: string[] = []) {
  return {
    vault: {
      on: jest.fn(() => ({ id: 'ref' })),
      offref: jest.fn(),
      adapter: { getBasePath: () => '/vault' },
      getAbstractFileByPath: jest.fn(() => null),
    },
    workspace: { getActiveFile: jest.fn(() => null), getLeaf: jest.fn() },
    metadataCache: { getFileCache: jest.fn(() => null) },
  } as any;
}

function bootTab(opts: { externalContexts?: string[] } = {}) {
  const externalContexts = opts.externalContexts ?? [];
  const container = createMockEl();
  const inputContainerEl = container.createDiv({ cls: 'claudian-input-container' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'claudian-input-wrapper' });
  const contextRowEl = container.createDiv({ cls: 'claudian-context-row' });
  const inputEl = createMockEl('textarea') as any;
  inputEl.value = '';

  const app = makeApp();
  const fileContext = new FileContextManager(
    app,
    contextRowEl,
    inputEl,
    {
      getExcludedTags: () => [],
      getExternalContexts: () => externalContexts,
    },
    inputContainerEl
  );
  const imageContext = new ImageContextManager(
    inputContainerEl,
    inputEl,
    { onImagesChanged: jest.fn() },
    contextRowEl
  );
  const dragManagerRef: { draggable: any } = { draggable: null };

  const dropController = new ChatDropController(inputContainerEl, {
    fileContext,
    imageContext,
    getVaultPath: () => '/vault',
    getExternalContexts: () => externalContexts,
    getDragManager: () => dragManagerRef,
    inputEl,
  });
  dropController.init();

  return { app, container, inputContainerEl, inputWrapper, contextRowEl, inputEl, fileContext, imageContext, dropController, dragManagerRef };
}

function dispatchDrop(target: any, dataTransfer: any): void {
  target.dispatchEvent({
    type: 'drop',
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer,
  });
}

describe('integration: chat drop flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds a dragged vault file as a chip pill', async () => {
    const tab = bootTab();
    const tFile = Object.assign(new TFile(), { path: 'notes/a.md' });
    tab.dragManagerRef.draggable = { type: 'file', file: tFile };

    dispatchDrop(tab.inputWrapper, { types: [], files: [], items: [] });
    await Promise.resolve();

    expect(tab.fileContext.getAttachedFiles().has('notes/a.md')).toBe(true);
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Added 1'));
  });

  it('rejects an out-of-vault OS folder with the dedicated notice', async () => {
    const tab = bootTab();
    const folder = { name: 'folder', type: '', size: 0, path: '/tmp/folder' };

    dispatchDrop(tab.inputWrapper, {
      types: ['Files'],
      files: [folder],
      items: [{
        kind: 'file',
        type: '',
        webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
        getAsFile: () => folder,
      }],
    });
    await Promise.resolve();

    expect(tab.fileContext.getAttachedFolders().size).toBe(0);
    expect(Notice).toHaveBeenCalledWith(expect.stringMatching(/outside/i));
  });

  it('inserts @ mention for an OS file inside an external context root', async () => {
    const tab = bootTab({ externalContexts: ['/ext/foo'] });
    const file = { name: 'x.ts', type: 'application/typescript', size: 10, path: '/ext/foo/src/x.ts' };

    dispatchDrop(tab.inputWrapper, { types: ['Files'], files: [file], items: [] });
    await Promise.resolve();

    expect(tab.inputEl.value).toContain('@foo/src/x.ts');
    expect(tab.fileContext.getAttachedFiles().has('/ext/foo/src/x.ts')).toBe(true);
  });
});
