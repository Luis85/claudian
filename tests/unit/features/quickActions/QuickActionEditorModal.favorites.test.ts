/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

import type { App } from 'obsidian';

import type { QuickAction } from '@/features/quickActions/types';
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
    addText(cb: (input: any) => void) {
      cb({ setValue: () => ({ onChange: () => undefined }), setDisabled: () => undefined, onChange: () => undefined });
      return this;
    }
    addTextArea(cb: (area: any) => void) {
      cb({
        setValue: () => ({ onChange: () => undefined }),
        onChange: () => undefined,
        inputEl: { rows: 0, addClass: () => undefined },
      });
      return this;
    }
    addButton(cb: (btn: any) => void) {
      cb({
        setButtonText: () => ({ setCta: () => ({ onClick: () => undefined }), onClick: () => undefined }),
        setCta: () => ({ onClick: () => undefined }),
        onClick: () => undefined,
      });
      return this;
    }
  }
  return {
    Modal,
    Notice: jest.fn(),
    Setting,
  };
});

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/shared/components/LucideIconPicker', () => ({
  LucideIconPicker: class {
    constructor(_parent: HTMLElement, _opts: { value: string; onChange: (v: string) => void }) {}
    destroy() {}
  },
}));

function makeExisting(p: Partial<QuickAction> = {}): QuickAction {
  return {
    id: p.id ?? 'existing-id',
    name: p.name ?? 'Existing',
    description: p.description ?? 'Existing description',
    prompt: p.prompt ?? 'Existing body.',
    filePath: p.filePath ?? 'Quick Actions/existing.md',
    icon: p.icon,
    tags: p.tags,
    favorite: p.favorite,
    favoriteRank: p.favoriteRank,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('QuickActionEditorModal favorites', () => {
  it('preserves favorite and favoriteRank when saving an edited action', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const existing = makeExisting({
      name: 'Daily',
      favorite: true,
      favoriteRank: 3,
      filePath: 'Quick Actions/daily.md',
    });
    const modal = new QuickActionEditorModal({} as App, existing, onSave);

    await (modal as any).handleSave('Daily', 'Updated description', '', 'Updated body.');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Daily',
      description: 'Updated description',
      prompt: 'Updated body.',
      filePath: 'Quick Actions/daily.md',
      favorite: true,
      favoriteRank: 3,
    }));
  });

  it('passes undefined favorite fields for non-favorited existing actions', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const existing = makeExisting({
      name: 'NotFav',
      filePath: 'Quick Actions/notfav.md',
    });
    const modal = new QuickActionEditorModal({} as App, existing, onSave);

    await (modal as any).handleSave('NotFav', 'desc', '', 'body');

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'NotFav',
      favorite: undefined,
      favoriteRank: undefined,
    }));
  });
});
