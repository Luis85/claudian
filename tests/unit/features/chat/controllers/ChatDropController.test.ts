// Mocks must be defined before imports
jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: any) => {
    const translations: Record<string, string> = {
      'chat.drop.image': 'Drop image',
      'chat.drop.fileContext': 'Drop into context',
      'chat.drop.folderContext': 'Drop folder into context',
      'chat.drop.osContext': 'Drop file or folder into context',
      'chat.drop.mixed': 'Drop into chat',
      'chat.drop.batchAdded': `Added ${params?.count ?? 1} items`,
      'chat.drop.externalFolderUnsupported': 'External folder not supported',
      'chat.drop.outsideContext': `File outside context: ${params?.path ?? 'unknown'}`,
      'chat.drop.outsideContextBatch': `${params?.count ?? 0} files outside context`,
      'chat.drop.batchSkipped': `Skipped ${params?.count ?? 1} items`,
      'chat.drop.imageFailed': `Failed to attach ${params?.count ?? 1} image(s)`,
    };
    return translations[key] || key;
  },
}));

import { createMockEl } from '@test/helpers/mockElement';
import { Notice, TFile, TFolder } from 'obsidian';

import { ChatDropController } from '@/features/chat/controllers/ChatDropController';

function makeDeps(overrides: Partial<any> = {}) {
  return {
    fileContext: {
      attachFileAsPill: jest.fn(() => true),
      attachFolderAsPill: jest.fn(() => true),
      attachExternalContextMention: jest.fn(() => true),
    },
    imageContext: {
      setImages: jest.fn(),
      getAttachedImages: jest.fn(() => []),
      hasImages: jest.fn(() => false),
      addImageFromFile: jest.fn(async () => true),
    },
    getVaultPath: () => '/Users/me/vault',
    getExternalContexts: () => [],
    getDragManager: () => null,
    inputEl: createMockEl('textarea'),
    ...overrides,
  };
}

describe('ChatDropController — scaffolding', () => {
  let containerEl: any;
  let inputWrapperEl: any;

  beforeEach(() => {
    containerEl = createMockEl();
    inputWrapperEl = containerEl.createDiv({ cls: 'claudian-input-wrapper' });
  });

  it('creates a drop overlay inside the input wrapper on init', () => {
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();
    expect(inputWrapperEl.children.length).toBeGreaterThan(0);
    const overlay = inputWrapperEl.children.find(
      (c: any) => c.hasClass?.('claudian-drop-overlay')
    );
    expect(overlay).toBeDefined();
  });

  it('removes its overlay and listeners on destroy', () => {
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();
    controller.destroy();
    const overlay = inputWrapperEl.children.find(
      (c: any) => c.hasClass?.('claudian-drop-overlay')
    );
    expect(overlay).toBeUndefined();
  });
});

function dispatchDragEnter(target: any, opts: { types?: string[]; dataTransfer?: any } = {}): any {
  const dataTransfer = opts.dataTransfer ?? {
    types: opts.types ?? ['Files'],
    files: [],
    items: [],
  };
  const event: any = {
    type: 'dragenter',
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer,
    clientX: 100,
    clientY: 100,
  };
  target.dispatchEvent(event);
  return event;
}

function dispatchDrop(target: any, dataTransfer: any): any {
  const event: any = {
    type: 'drop',
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer,
  };
  target.dispatchEvent(event);
  return event;
}

describe('ChatDropController — overlay label', () => {
  let containerEl: any;
  let inputWrapperEl: any;

  beforeEach(() => {
    containerEl = createMockEl();
    inputWrapperEl = containerEl.createDiv({ cls: 'claudian-input-wrapper' });
  });

  it('shows "Drop image" label when only OS image MIME is present', () => {
    const controller = new ChatDropController(containerEl, makeDeps());
    controller.init();
    dispatchDragEnter(inputWrapperEl, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'x.png', type: 'image/png', size: 10 }],
        items: [],
      },
    });
    const overlay = inputWrapperEl.children.find((c: any) => c.hasClass?.('claudian-drop-overlay'));
    expect(overlay?.hasClass('visible')).toBe(true);
    expect(overlay?.textContent).toContain('Drop image');
  });

  it('shows "Drop into context" when an Obsidian internal file drag is active', () => {
    const tFile = Object.assign(new TFile(), { path: 'a.md' });
    const deps = makeDeps({
      getDragManager: () => ({ draggable: { type: 'file', file: tFile } }),
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();
    dispatchDragEnter(inputWrapperEl, { types: [] });
    const overlay = inputWrapperEl.children.find((c: any) => c.hasClass?.('claudian-drop-overlay'));
    expect(overlay?.textContent).toContain('Drop into context');
  });

  it('hides overlay on dragleave outside wrapper rect', () => {
    const controller = new ChatDropController(containerEl, makeDeps());
    controller.init();
    dispatchDragEnter(inputWrapperEl, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'x.png', type: 'image/png', size: 10 }],
        items: [],
      },
    });
    const overlay = inputWrapperEl.children.find((c: any) => c.hasClass?.('claudian-drop-overlay'));
    expect(overlay?.hasClass('visible')).toBe(true);

    // Simulate dragleave outside the wrapper rect
    inputWrapperEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 50, bottom: 50 });
    inputWrapperEl.dispatchEvent({
      type: 'dragleave',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      clientX: 100,
      clientY: 100,
    });
    expect(overlay?.hasClass('visible')).toBe(false);
  });
});

describe('ChatDropController — drop routing', () => {
  let containerEl: any;
  let inputWrapperEl: any;

  beforeEach(() => {
    jest.clearAllMocks();
    containerEl = createMockEl();
    inputWrapperEl = containerEl.createDiv({ cls: 'claudian-input-wrapper' });
  });

  it('routes Obsidian internal TFile drag to attachFileAsPill', async () => {
    const tFile = Object.assign(new TFile(), { path: 'notes/a.md' });
    const deps = makeDeps({
      getDragManager: () => ({ draggable: { type: 'file', file: tFile } }),
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: [], files: [], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachFileAsPill).toHaveBeenCalledWith('notes/a.md');
  });

  it('routes Obsidian internal TFolder drag to attachFolderAsPill', async () => {
    const tFolder = Object.assign(new TFolder(), { path: 'notes/sub' });
    const deps = makeDeps({
      getDragManager: () => ({ draggable: { type: 'folder', file: tFolder } }),
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: [], files: [], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachFolderAsPill).toHaveBeenCalledWith('notes/sub');
  });

  it('routes OS image MIME to imageContext.addImageFromFile', async () => {
    const file = { name: 'x.png', type: 'image/png', size: 10, path: '/tmp/x.png' };
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [file], items: [] });
    await Promise.resolve();

    expect(deps.imageContext.addImageFromFile).toHaveBeenCalledWith(file, 'drop');
  });

  it('routes OS file under vault to attachFileAsPill with relative path', async () => {
    const file = { name: 'a.md', type: 'text/markdown', size: 10, path: '/Users/me/vault/notes/a.md' };
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [file], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachFileAsPill).toHaveBeenCalledWith('notes/a.md');
  });

  it('routes OS file under external root to attachExternalContextMention', async () => {
    const file = { name: 'x.ts', type: 'application/typescript', size: 10, path: '/ext/foo/src/x.ts' };
    const deps = makeDeps({
      getExternalContexts: () => ['/ext/foo'],
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [file], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachExternalContextMention)
      .toHaveBeenCalledWith('/ext/foo/src/x.ts');
  });

  it('rejects out-of-vault OS folder via dedicated notice and never attaches', async () => {
    const file = { name: 'folder', type: '', size: 0, path: '/ext/foo/sub' };
    const deps = makeDeps({
      getExternalContexts: () => ['/ext/foo'],
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    const items = [{
      kind: 'file',
      type: '',
      webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
      getAsFile: () => file,
    }];
    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [file], items });
    await Promise.resolve();

    expect(deps.fileContext.attachFolderAsPill).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('External folder not supported');
  });

  it('handles a mixed batch — 1 vault file + 1 OS image + 1 rejected path', async () => {
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    const vault = { name: 'a.md', type: 'text/markdown', size: 10, path: '/Users/me/vault/notes/a.md' };
    const img = { name: 'x.png', type: 'image/png', size: 10, path: '/tmp/x.png' };
    const reject = { name: 'y.md', type: 'text/markdown', size: 10, path: '/elsewhere/y.md' };
    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [vault, img, reject], items: [] });
    await Promise.resolve();

    expect(deps.fileContext.attachFileAsPill).toHaveBeenCalledWith('notes/a.md');
    expect(deps.imageContext.addImageFromFile).toHaveBeenCalledWith(img, 'drop');
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('outside'));
  });

  it('fires imageFailed notice when addImageFromFile returns false', async () => {
    const deps = makeDeps({
      imageContext: {
        setImages: jest.fn(),
        getAttachedImages: jest.fn(() => []),
        hasImages: jest.fn(() => false),
        addImageFromFile: jest.fn(async () => false),
      },
    });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    const img = { name: 'big.png', type: 'image/png', size: 999999, path: '/tmp/big.png' };
    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [img], items: [] });
    await Promise.resolve();

    expect(Notice).toHaveBeenCalledWith('Failed to attach 1 image(s)');
    expect(Notice).not.toHaveBeenCalledWith(expect.stringContaining('Skipped'));
  });

  it('uses outsideContextBatch when multiple paths are outside vault and external roots', async () => {
    const deps = makeDeps();
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    const a = { name: 'a.md', type: 'text/markdown', size: 10, path: '/elsewhere/a.md' };
    const b = { name: 'b.md', type: 'text/markdown', size: 10, path: '/somewhere/b.md' };
    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [a, b], items: [] });
    await Promise.resolve();

    expect(Notice).toHaveBeenCalledWith('2 files outside context');
  });

  it('fires both external-folder and outside-context notices in a multi-kind rejection batch', async () => {
    const deps = makeDeps({ getExternalContexts: () => ['/ext/foo'] });
    const controller = new ChatDropController(containerEl, deps);
    controller.init();

    // 1 OS folder under an external root → external-folder-unsupported
    // 1 OS file outside everything → outside-context
    const extFolder = { name: 'sub', type: '', size: 0, path: '/ext/foo/sub' };
    const stray = { name: 'z.md', type: 'text/markdown', size: 10, path: '/somewhere/z.md' };
    const items = [{
      kind: 'file',
      type: '',
      webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
      getAsFile: () => extFolder,
    }];
    dispatchDrop(inputWrapperEl, { types: ['Files'], files: [extFolder, stray], items });
    await Promise.resolve();

    expect(deps.fileContext.attachFolderAsPill).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('External folder not supported');
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('outside'));
  });
});
