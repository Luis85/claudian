/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

import type { App } from 'obsidian';
import { Notice } from 'obsidian';

import { QuickActionEditorModal } from '@/features/quickActions/ui/QuickActionEditorModal';

import { createStorageMock } from './_helpers/quickActionStorageMock';

// Module-scope captures for setValue() and LucideIconPicker initial value.
// Modal renders settings in order: name, description, icon, prompt.
const mockTextSetValues: string[] = [];
const mockTextAreaSetValues: string[] = [];
const mockIconInitialValues: string[] = [];
let mockSetDisabledCalled = false;

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
      const input: any = {
        setValue(v: string) {
          mockTextSetValues.push(v);
          return input;
        },
        setDisabled() {
          mockSetDisabledCalled = true;
          return input;
        },
        onChange() { return input; },
      };
      cb(input);
      return this;
    }
    addTextArea(cb: (a: any) => void) {
      const area: any = {
        setValue(v: string) {
          mockTextAreaSetValues.push(v);
          return area;
        },
        onChange() { return area; },
        inputEl: { rows: 0, addClass() {} },
      };
      cb(area);
      return this;
    }
    addButton(cb: (b: any) => void) {
      const btn: any = {
        setButtonText() { return btn; },
        setCta() { return btn; },
        onClick() { return btn; },
      };
      cb(btn);
      return this;
    }
  }
  return { Modal, Notice: jest.fn(), Setting };
});

jest.mock('@/i18n/i18n', () => ({ t: (key: string) => key }));
jest.mock('@/shared/components/LucideIconPicker', () => ({
  LucideIconPicker: class {
    constructor(_p: HTMLElement, opts: { value: string; onChange: (v: string) => void }) {
      mockIconInitialValues.push(opts.value);
    }
    destroy() {}
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockTextSetValues.length = 0;
  mockTextAreaSetValues.length = 0;
  mockIconInitialValues.length = 0;
  mockSetDisabledCalled = false;
});

describe('QuickActionEditorModal capture seed + collision guard', () => {
  it('pre-fills name and prompt from seed on Add flow (drives onOpen)', () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const storage = createStorageMock();
    const modal = new QuickActionEditorModal(
      {} as App,
      null,
      onSave,
      storage,
      { name: 'Seeded name', prompt: 'Seeded prompt body.' },
    );

    modal.open();

    // onOpen renders: name (addText), description (addText), icon (LucideIconPicker), prompt (addTextArea).
    expect(mockTextSetValues[0]).toBe('Seeded name');
    expect(mockTextSetValues[1]).toBe(''); // description has no seed
    expect(mockIconInitialValues[0]).toBe('');
    expect(mockTextAreaSetValues[0]).toBe('Seeded prompt body.');
    // Add flow must leave the name field editable.
    expect(mockSetDisabledCalled).toBe(false);
  });

  it('falls back to empty fields on Add when no seed is given', () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new QuickActionEditorModal({} as App, null, onSave, createStorageMock());

    modal.open();

    expect(mockTextSetValues[0]).toBe('');
    expect(mockTextAreaSetValues[0]).toBe('');
  });

  it('blocks save with a notice when the slug already exists (Add flow)', async () => {
    const onSave = jest.fn();
    const storage = createStorageMock({ exists: true });
    const modal = new QuickActionEditorModal({} as App, null, onSave, storage);

    await (modal as any).handleSave('Existing', '', '', 'Body');

    expect(storage.exists).toHaveBeenCalledWith('Quick Actions/existing.md');
    expect(Notice).toHaveBeenCalledWith('quickActions.editor.nameExists');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('skips the collision guard on Edit flow (existing.filePath is set)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const storage = createStorageMock({ exists: true });
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

  it('renders form from existing (not seed) when both are supplied; Edit disables the name field', () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new QuickActionEditorModal(
      {} as App,
      {
        id: 'edit-id',
        name: 'Existing name',
        description: 'existing desc',
        icon: 'star',
        prompt: 'existing body',
        filePath: 'Quick Actions/existing-name.md',
      },
      onSave,
      createStorageMock(),
      { name: 'Ignored seed', prompt: 'Ignored prompt' },
    );

    modal.open();

    expect(mockTextSetValues[0]).toBe('Existing name');
    expect(mockTextSetValues[1]).toBe('existing desc');
    expect(mockIconInitialValues[0]).toBe('star');
    expect(mockTextAreaSetValues[0]).toBe('existing body');
    // Edit flow must disable name to keep the filename frozen.
    expect(mockSetDisabledCalled).toBe(true);
  });
});
