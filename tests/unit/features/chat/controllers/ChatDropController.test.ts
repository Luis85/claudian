// Mocks must be defined before imports
jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => {
    const translations: Record<string, string> = {
      'chat.drop.image': 'Drop image',
      'chat.drop.fileContext': 'Drop into context',
      'chat.drop.folderContext': 'Drop folder into context',
      'chat.drop.osContext': 'Drop file or folder into context',
      'chat.drop.mixed': 'Drop into chat',
    };
    return translations[key] || key;
  },
}));

import { createMockEl } from '@test/helpers/mockElement';
import { TFile } from 'obsidian';

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
