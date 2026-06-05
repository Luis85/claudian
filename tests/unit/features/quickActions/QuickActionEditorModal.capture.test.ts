/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

import type { App } from 'obsidian';
import { Notice } from 'obsidian';

import type { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import { QuickActionEditorModal } from '@/features/quickActions/ui/QuickActionEditorModal';

jest.mock('obsidian', () => {
  class Modal {
    app: any;
    contentEl: any;
    modalEl: any;
    constructor(app: any) {
      this.app = app;
      this.contentEl = document.createElement('div');
      this.modalEl = document.createElement('div');
    }
    setTitle() {}
    open() { this.onOpen?.(); }
    close() {}
    onOpen?(): void;
  }
  class Setting {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(container: HTMLElement) {
      this.settingEl = document.createElement('div');
      this.controlEl = document.createElement('div');
      container.appendChild(this.settingEl);
    }
    setName() { return this; }
    setDesc() { return this; }
    addText(cb: (i: any) => void) {
      cb({ setValue: () => ({ onChange: () => undefined }), setDisabled: () => undefined, onChange: () => undefined });
      return this;
    }
    addTextArea(cb: (a: any) => void) {
      cb({ setValue: () => ({ onChange: () => undefined }), onChange: () => undefined, inputEl: { rows: 0, addClass: () => undefined } });
      return this;
    }
    addButton(cb: (b: any) => void) {
      cb({ setButtonText: () => ({ setCta: () => ({ onClick: () => undefined }), onClick: () => undefined }), setCta: () => ({ onClick: () => undefined }), onClick: () => undefined });
      return this;
    }
  }
  return { Modal, Notice: jest.fn(), Setting };
});

jest.mock('@/i18n/i18n', () => ({ t: (key: string) => key }));
jest.mock('@/shared/components/LucideIconPicker', () => ({
  LucideIconPicker: class {
    constructor(_p: HTMLElement, _o: { value: string; onChange: (v: string) => void }) {}
    destroy() {}
  },
}));

function makeStorage(exists = false): jest.Mocked<QuickActionStorage> {
  return {
    exists: jest.fn(async () => exists),
    getFilePathForName: jest.fn((name: string) => `Quick Actions/${name.toLowerCase()}.md`),
    save: jest.fn(),
    delete: jest.fn(),
    loadAll: jest.fn(),
    loadFromFile: jest.fn(),
    setFavorite: jest.fn(),
    unsetFavorite: jest.fn(),
  } as unknown as jest.Mocked<QuickActionStorage>;
}

beforeEach(() => jest.clearAllMocks());

describe('QuickActionEditorModal capture seed + collision guard', () => {
  it('pre-fills name and prompt from seed on Add flow', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(false);
    const modal = new QuickActionEditorModal(
      {} as App,
      null,
      onSave,
      storage,
      { name: 'Seeded name', prompt: 'Seeded prompt body.' },
    );

    await (modal as any).handleSave('Seeded name', '', '', 'Seeded prompt body.');

    expect(storage.exists).toHaveBeenCalledWith('Quick Actions/seeded name.md');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Seeded name',
      prompt: 'Seeded prompt body.',
      filePath: '',
    }));
  });

  it('blocks save with a notice when the slug already exists (Add flow)', async () => {
    const onSave = jest.fn();
    const storage = makeStorage(true);
    const modal = new QuickActionEditorModal({} as App, null, onSave, storage);

    await (modal as any).handleSave('Existing', '', '', 'Body');

    expect(Notice).toHaveBeenCalledWith('quickActions.editor.nameExists');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('skips the collision guard on Edit flow (existing.filePath is set)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(true);
    const modal = new QuickActionEditorModal(
      {} as App,
      {
        id: 'edit-id',
        name: 'Edit me',
        description: 'd',
        prompt: 'p',
        filePath: 'Quick Actions/edit-me.md',
      },
      onSave,
      storage,
    );

    await (modal as any).handleSave('Edit me', 'd2', '', 'p2');

    expect(storage.exists).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('ignores seed when existing is present', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(false);
    const modal = new QuickActionEditorModal(
      {} as App,
      {
        id: 'edit-id',
        name: 'Existing name',
        description: 'd',
        prompt: 'existing body',
        filePath: 'Quick Actions/existing-name.md',
      },
      onSave,
      storage,
      { name: 'Ignored seed', prompt: 'Ignored prompt' },
    );

    expect((modal as any).existing.name).toBe('Existing name');
    expect((modal as any).seed?.name).toBe('Ignored seed');
  });
});
