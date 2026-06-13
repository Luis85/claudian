import { Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { TriggerInputMode } from './triggerInputMode';

export interface BangBashModeCallbacks {
  onSubmit: (command: string) => Promise<void>;
  getInputWrapper: () => HTMLElement | null;
  resetInputHeight?: () => void;
}

export class BangBashModeManager {
  private inputEl: HTMLTextAreaElement;
  private callbacks: BangBashModeCallbacks;
  private mode: TriggerInputMode;
  private isSubmitting = false;

  constructor(
    inputEl: HTMLTextAreaElement,
    callbacks: BangBashModeCallbacks
  ) {
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.mode = new TriggerInputMode(inputEl, callbacks.getInputWrapper, {
      triggerKey: '!',
      wrapperClass: 'claudian-input-bang-bash-mode',
      activePlaceholder: t('chat.bangBash.placeholder'),
    });
  }

  handleTriggerKey(e: KeyboardEvent): boolean {
    if (this.mode.shouldTrigger(e)) {
      if (this.mode.enter()) {
        e.preventDefault();
        return true;
      }
    }
    return false;
  }

  handleInputChange(): void {
    if (!this.mode.isActive()) return;
    this.mode.setRaw(this.inputEl.value);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.mode.isActive()) return false;

    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (this.mode.getRaw().trim()) {
        void this.submit();
      }
      return true;
    }

    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.clear();
      return true;
    }

    return false;
  }

  isActive(): boolean {
    return this.mode.isActive();
  }

  getRawCommand(): string {
    return this.mode.getRaw();
  }

  private async submit(): Promise<void> {
    if (this.isSubmitting) return;

    const rawCommand = this.mode.getRaw().trim();
    if (!rawCommand) return;

    this.isSubmitting = true;

    try {
      this.clear();
      await this.callbacks.onSubmit(rawCommand);
    } catch (e) {
      new Notice(t('chat.bangBash.commandFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.isSubmitting = false;
    }
  }

  clear(): void {
    this.inputEl.value = '';
    this.mode.exit();
    this.callbacks.resetInputHeight?.();
  }

  destroy(): void {
    this.mode.exit();
  }
}
