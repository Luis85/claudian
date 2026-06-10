/**
 * Shared chrome for inline approval cards (plan approval, exit-plan-mode,
 * ask-user-question): focusable root activation and the numbered choice list
 * with arrow-key navigation and an optional free-text row.
 */

export const CHOICE_CARD_HINTS_TEXT = 'Arrow keys to navigate \u00B7 Enter to select \u00B7 Esc to cancel';

/**
 * Makes the card root focusable, wires keyboard handling, defers focus/scroll
 * to after the element is in the DOM and laid out, and optionally dismisses on
 * abort. Returns a dispose that detaches the listeners (idempotent-safe to call
 * during resolve teardown).
 */
export function activateInlineCard(params: {
  rootEl: HTMLElement;
  onKeyDown: (e: KeyboardEvent) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}): () => void {
  const { rootEl, onKeyDown, signal, onAbort } = params;

  rootEl.setAttribute('tabindex', '0');
  rootEl.addEventListener('keydown', onKeyDown);

  window.requestAnimationFrame(() => {
    rootEl.focus();
    rootEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  let abortHandler: (() => void) | null = null;
  if (signal && onAbort) {
    abortHandler = onAbort;
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  return () => {
    rootEl.removeEventListener('keydown', onKeyDown);
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
      abortHandler = null;
    }
  };
}

export type InlineChoiceRowSpec =
  | { kind: 'action'; label: string; onSelect: () => void }
  | { kind: 'input'; placeholder: string; onSubmit: (text: string) => void };

export class InlineChoiceList {
  // Navigation state is intentionally public: host cards (and their specs)
  // observe and occasionally override it, e.g. to release input focus.
  focusedIndex = 0;
  isInputFocused = false;
  inputEl: HTMLInputElement | null = null;
  private items: HTMLElement[] = [];

  constructor(
    private readonly rootEl: HTMLElement,
    private readonly specs: InlineChoiceRowSpec[],
    private readonly onCancel: () => void,
  ) {}

  render(listEl: HTMLElement): void {
    this.specs.forEach((spec, index) => this.renderRow(listEl, spec, index));
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (this.isInputFocused) {
      this.handleInputModeKeyDown(e);
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.focusedIndex = Math.min(this.focusedIndex + 1, this.items.length - 1);
        this.updateFocus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
        this.updateFocus();
        break;
      case 'Enter': {
        e.preventDefault();
        e.stopPropagation();
        const spec = this.specs[this.focusedIndex];
        if (spec?.kind === 'action') {
          spec.onSelect();
        } else if (spec?.kind === 'input') {
          this.inputEl?.focus();
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.onCancel();
        break;
    }
  }

  private handleInputModeKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.isInputFocused = false;
      this.inputEl?.blur();
      this.rootEl.focus();
      return;
    }
    if (e.key === 'Enter' && this.inputEl && this.inputEl.value.trim()) {
      e.preventDefault();
      e.stopPropagation();
      const spec = this.specs[this.focusedIndex];
      if (spec?.kind === 'input') {
        spec.onSubmit(this.inputEl.value.trim());
      }
    }
  }

  private renderRow(listEl: HTMLElement, spec: InlineChoiceRowSpec, index: number): void {
    const isInput = spec.kind === 'input';
    const row = listEl.createDiv({
      cls: isInput ? 'claudian-ask-item claudian-ask-custom-item' : 'claudian-ask-item',
    });
    if (index === 0) {
      row.addClass('is-focused');
    }
    row.createSpan({ text: index === 0 ? '\u203A' : '\u00A0', cls: 'claudian-ask-cursor' });
    row.createSpan({ text: `${index + 1}. `, cls: 'claudian-ask-item-num' });

    if (spec.kind === 'input') {
      const input = row.createEl('input', {
        type: 'text',
        cls: 'claudian-ask-custom-text',
        placeholder: spec.placeholder,
      });
      input.addEventListener('focus', () => { this.isInputFocused = true; });
      input.addEventListener('blur', () => { this.isInputFocused = false; });
      row.addEventListener('click', () => {
        this.focusedIndex = index;
        this.updateFocus();
      });
      this.inputEl = input;
    } else {
      row.createSpan({ text: spec.label, cls: 'claudian-ask-item-label' });
      row.addEventListener('click', () => {
        this.focusedIndex = index;
        this.updateFocus();
        spec.onSelect();
      });
    }

    this.items.push(row);
  }

  private updateFocus(): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const cursor = item.querySelector('.claudian-ask-cursor');
      if (i === this.focusedIndex) {
        item.addClass('is-focused');
        if (cursor) cursor.textContent = '\u203A';
        item.scrollIntoView({ block: 'nearest' });

        if (item.hasClass('claudian-ask-custom-item')) {
          const input = item.querySelector('.claudian-ask-custom-text') as HTMLInputElement;
          if (input) {
            input.focus();
            this.isInputFocused = true;
          }
        }
      } else {
        item.removeClass('is-focused');
        if (cursor) cursor.textContent = '\u00A0';

        if (item.hasClass('claudian-ask-custom-item')) {
          const input = item.querySelector('.claudian-ask-custom-text') as HTMLInputElement;
          if (input && this.rootEl.ownerDocument.activeElement === input) {
            input.blur();
            this.isInputFocused = false;
          }
        }
      }
    }
  }
}
