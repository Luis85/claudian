/**
 * Claudian - Chat drop controller.
 *
 * Owns the drag-and-drop lifecycle for one chat tab's input wrapper. Routes
 * dropped vault files, vault folders, OS images, and external-context files
 * through the existing chat services.
 */

import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { DragManagerLike } from './dropPayloadDetection';

export interface ChatDropDeps {
  fileContext: Pick<FileContextManager,
    'attachFileAsPill' | 'attachFolderAsPill' | 'attachExternalContextMention'>;
  imageContext: Pick<ImageContextManager, 'addImageFromFile'>;
  getVaultPath: () => string;
  getExternalContexts: () => string[];
  getDragManager: () => DragManagerLike | null;
  inputEl: HTMLTextAreaElement;
}

export class ChatDropController {
  private containerEl: HTMLElement;
  private deps: ChatDropDeps;
  private inputWrapperEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private overlayLabelEl: HTMLElement | null = null;
  private listeners: Array<{ type: string; handler: (e: Event) => void }> = [];

  constructor(containerEl: HTMLElement, deps: ChatDropDeps) {
    this.containerEl = containerEl;
    this.deps = deps;
  }

  init(): void {
    const wrapper = this.containerEl.querySelector('.claudian-input-wrapper') as HTMLElement | null;
    if (!wrapper) return;
    this.inputWrapperEl = wrapper;

    this.overlayEl = wrapper.createDiv({ cls: 'claudian-drop-overlay' });
    const content = this.overlayEl.createDiv({ cls: 'claudian-drop-content' });
    this.overlayLabelEl = content.createSpan({ text: '' });
  }

  destroy(): void {
    if (this.inputWrapperEl) {
      for (const { type, handler } of this.listeners) {
        this.inputWrapperEl.removeEventListener(type, handler);
      }
    }
    this.listeners = [];
    if (this.overlayEl) {
      const parent = this.overlayEl.parentElement || (this.inputWrapperEl as any);
      if (parent && parent.children) {
        const idx = parent.children.indexOf(this.overlayEl);
        if (idx !== -1) {
          parent.children.splice(idx, 1);
        }
      }
      this.overlayEl.remove?.();
    }
    this.overlayEl = null;
    this.overlayLabelEl = null;
    this.inputWrapperEl = null;
  }
}
