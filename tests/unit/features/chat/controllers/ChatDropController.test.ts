import { createMockEl } from '@test/helpers/mockElement';

import { ChatDropController } from '@/features/chat/controllers/ChatDropController';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

function makeDeps(overrides: Partial<any> = {}) {
  return {
    fileContext: {
      attachFileAsPill: jest.fn(() => true),
      attachFolderAsPill: jest.fn(() => true),
      attachExternalContextMention: jest.fn(() => true),
    },
    imageContext: {
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
