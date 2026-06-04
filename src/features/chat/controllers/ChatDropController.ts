/**
 * Claudian - Chat drop controller.
 *
 * Owns the drag-and-drop lifecycle for one chat tab's input wrapper. Routes
 * dropped vault files, vault folders, OS images, and external-context files
 * through the existing chat services.
 */

import { t } from '@/i18n/i18n';
import type { TranslationKey } from '@/i18n/types';

import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import { detectPayload, type DragManagerLike,type DroppedPayload } from './dropPayloadDetection';

export interface ChatDropDeps {
  fileContext: Pick<FileContextManager,
    'attachFileAsPill' | 'attachFolderAsPill' | 'attachExternalContextMention'>;
  imageContext: Pick<ImageContextManager, 'setImages' | 'getAttachedImages' | 'hasImages'>;
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
    this.overlayLabelEl = content.createSpan();

    this.addListener('dragenter', (e) => this.handleDragEnter(e as DragEvent));
    this.addListener('dragover', (e) => this.handleDragOver(e as DragEvent));
    this.addListener('dragleave', (e) => this.handleDragLeave(e as DragEvent));
    this.addListener('drop', (e) => {
      void this.handleDrop(e as DragEvent);
    });
  }

  private addListener(type: string, handler: (e: Event) => void): void {
    this.inputWrapperEl?.addEventListener(type, handler);
    this.listeners.push({ type, handler });
  }

  private handleDragEnter(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!this.overlayEl || !this.overlayLabelEl) return;

    const payload = this.peekPayload(e.dataTransfer as DataTransfer | null);
    const labelKey = pickOverlayLabel(payload);
    if (!labelKey) return;

    this.overlayLabelEl.setText(t(labelKey));
    this.overlayEl.addClass('visible');
  }

  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!this.inputWrapperEl || !this.overlayEl) return;
    const rect = this.inputWrapperEl.getBoundingClientRect();
    if (
      e.clientX <= rect.left || e.clientX >= rect.right ||
      e.clientY <= rect.top || e.clientY >= rect.bottom
    ) {
      this.overlayEl.removeClass('visible');
    }
  }

  private peekPayload(dataTransfer: DataTransfer | null): DroppedPayload {
    if (!dataTransfer) {
      return {
        vaultFiles: [], vaultFolders: [],
        osImageFiles: [], osFiles: [], osFolders: [],
        unknown: 0,
      };
    }
    return detectPayload(dataTransfer, this.deps.getDragManager());
  }

  private async handleDrop(_e: DragEvent): Promise<void> {
    // implemented in Task 7
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

function pickOverlayLabel(payload: DroppedPayload): TranslationKey | null {
  const hasVaultFile = payload.vaultFiles.length > 0;
  const hasVaultFolder = payload.vaultFolders.length > 0;
  const hasOsImage = payload.osImageFiles.length > 0;
  const hasOsFile = payload.osFiles.length > 0;
  const hasOsFolder = payload.osFolders.length > 0;

  const pathish = hasVaultFile || hasVaultFolder || hasOsFile || hasOsFolder;
  if (hasOsImage && pathish) return 'chat.drop.mixed';
  if (hasOsImage) return 'chat.drop.image';
  if (hasVaultFolder && !hasVaultFile) return 'chat.drop.folderContext';
  if (hasVaultFile) return 'chat.drop.fileContext';
  if (hasOsFile || hasOsFolder) return 'chat.drop.osContext';
  return null;
}
