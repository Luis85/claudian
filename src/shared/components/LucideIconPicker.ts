import { setIcon } from 'obsidian';

import { t } from '../../i18n/i18n';
import { filterLucideIcons } from '../icons/lucideIconCatalog';

export interface LucideIconPickerOptions {
  value: string;
  onChange: (iconId: string) => void;
}

function iconRenders(iconId: string, host: HTMLElement): boolean {
  host.empty();
  setIcon(host, iconId);
  return Boolean(host.querySelector('svg'));
}

export class LucideIconPicker {
  private rootEl: HTMLElement;
  private triggerEl: HTMLElement;
  private triggerIconEl: HTMLElement;
  private triggerLabelEl: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private gridEl: HTMLElement | null = null;
  private value: string;
  private onChange: (iconId: string) => void;
  private isOpen = false;
  private onDocumentPointerDown: (event: PointerEvent) => void;

  constructor(parentEl: HTMLElement, options: LucideIconPickerOptions) {
    this.value = options.value;
    this.onChange = options.onChange;
    this.onDocumentPointerDown = (event) => {
      if (!this.isOpen || !this.rootEl.isConnected) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && this.rootEl.contains(target)) {
        return;
      }
      this.close();
    };

    this.rootEl = parentEl.createDiv({ cls: 'claudian-lucide-icon-picker' });
    this.triggerEl = this.rootEl.createDiv({ cls: 'claudian-lucide-icon-picker-trigger' });
    this.triggerEl.setAttr('role', 'button');
    this.triggerEl.setAttr('tabindex', '0');

    this.triggerIconEl = this.triggerEl.createSpan({ cls: 'claudian-lucide-icon-picker-trigger-icon' });
    this.triggerLabelEl = this.triggerEl.createSpan({ cls: 'claudian-lucide-icon-picker-trigger-label' });
    this.triggerEl.createSpan({ cls: 'claudian-lucide-icon-picker-trigger-chevron' });

    this.updateTrigger();
    this.triggerEl.addEventListener('click', () => {
      this.toggle();
    });
    this.triggerEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggle();
      }
      if (event.key === 'Escape' && this.isOpen) {
        event.preventDefault();
        this.close();
      }
    });
  }

  setValue(iconId: string): void {
    this.value = iconId;
    this.updateTrigger();
    if (this.isOpen) {
      this.renderGrid();
    }
  }

  destroy(): void {
    this.close();
    this.rootEl.remove();
  }

  private toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  private open(): void {
    if (this.isOpen) {
      return;
    }
    this.isOpen = true;
    this.triggerEl.addClass('is-open');

    this.dropdownEl = this.rootEl.createDiv({ cls: 'claudian-lucide-icon-picker-dropdown' });

    const searchWrap = this.dropdownEl.createDiv({ cls: 'claudian-lucide-icon-picker-search' });
    this.searchInputEl = searchWrap.createEl('input', {
      type: 'search',
      cls: 'claudian-lucide-icon-picker-search-input',
    });
    this.searchInputEl.placeholder = t('quickActions.editor.iconSearch');
    this.searchInputEl.addEventListener('input', () => {
      this.renderGrid();
    });
    this.searchInputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        this.triggerEl.focus();
      }
    });

    this.gridEl = this.dropdownEl.createDiv({ cls: 'claudian-lucide-icon-picker-grid' });
    this.renderGrid();

    window.setTimeout(() => {
      this.searchInputEl?.focus();
    }, 0);

    this.rootEl.ownerDocument.addEventListener('pointerdown', this.onDocumentPointerDown, true);
  }

  private close(): void {
    if (!this.isOpen) {
      return;
    }
    this.isOpen = false;
    this.triggerEl.removeClass('is-open');
    this.rootEl.ownerDocument.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    this.dropdownEl?.remove();
    this.dropdownEl = null;
    this.searchInputEl = null;
    this.gridEl = null;
  }

  private updateTrigger(): void {
    this.triggerIconEl.empty();
    const trimmed = this.value.trim();
    if (trimmed && iconRenders(trimmed, this.triggerIconEl)) {
      this.triggerLabelEl.setText(trimmed);
      this.triggerEl.removeClass('is-empty');
      return;
    }
    this.triggerIconEl.setText('—');
    this.triggerLabelEl.setText(
      trimmed
        ? trimmed
        : t('quickActions.editor.iconNone'),
    );
    this.triggerEl.toggleClass('is-empty', !trimmed);
  }

  private renderGrid(): void {
    if (!this.gridEl) {
      return;
    }
    this.gridEl.empty();

    const query = this.searchInputEl?.value ?? '';
    const filtered = filterLucideIcons(query);

    const noneBtn = this.gridEl.createEl('button', {
      cls: 'claudian-lucide-icon-picker-item claudian-lucide-icon-picker-item-none',
      attr: { type: 'button', title: t('quickActions.editor.iconNone') },
    });
    noneBtn.createSpan({ text: '—' });
    if (!this.value.trim()) {
      noneBtn.addClass('is-selected');
    }
    noneBtn.addEventListener('click', () => {
      this.select('');
    });

    let rendered = 0;
    for (const iconId of filtered) {
      const btn = this.gridEl.createEl('button', {
        cls: 'claudian-lucide-icon-picker-item',
        attr: { type: 'button', title: iconId },
      });
      if (!iconRenders(iconId, btn)) {
        btn.remove();
        continue;
      }
      if (iconId === this.value.trim()) {
        btn.addClass('is-selected');
      }
      btn.addEventListener('click', () => {
        this.select(iconId);
      });
      rendered += 1;
    }

    if (rendered === 0 && query.trim()) {
      this.gridEl.createDiv({
        cls: 'claudian-lucide-icon-picker-empty',
        text: t('quickActions.editor.iconNoResults'),
      });
    }
  }

  private select(iconId: string): void {
    this.value = iconId;
    this.onChange(iconId);
    this.updateTrigger();
    this.renderGrid();
    this.close();
    this.triggerEl.focus();
  }
}
