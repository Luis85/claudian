/**
 * Claudian - Chat drop controller.
 *
 * Owns the drag-and-drop lifecycle for one chat tab's input wrapper. Routes
 * dropped vault files, vault folders, OS images, and external-context files
 * through the existing chat services.
 */

import { Notice } from 'obsidian';

import { t } from '@/i18n/i18n';
import type { TranslationKey } from '@/i18n/types';

import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import {
  detectPayload,
  type DragManagerLike,
  type DroppedPayload,
  getFilePath,
} from './dropPayloadDetection';
import { classifyOsPath } from './osPathClassification';

export interface ChatDropDeps {
  fileContext: Pick<FileContextManager,
    'attachFileAsPill' | 'attachFolderAsPill' | 'attachExternalContextMention'>;
  imageContext: Pick<ImageContextManager, 'setImages' | 'getAttachedImages' | 'hasImages' | 'addImageFromFile'>;
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

  // Called on dragenter where browsers restrict file content access for security.
  // A second full detectPayload call is made in handleDrop where content is available.
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

  private async handleDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    this.overlayEl?.removeClass('visible');

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;

    const payload = detectPayload(dataTransfer, this.deps.getDragManager());

    const attached: string[] = [];
    const rejected: Array<{ path: string; reason: 'attach-failed' | 'image-failed' | 'outside-context' | 'external-folder-unsupported' }> = [];

    for (const file of payload.vaultFiles) {
      if (this.deps.fileContext.attachFileAsPill(file.path)) attached.push(file.path);
      else rejected.push({ path: file.path, reason: 'attach-failed' });
    }

    for (const folder of payload.vaultFolders) {
      if (this.deps.fileContext.attachFolderAsPill(folder.path)) attached.push(folder.path);
      else rejected.push({ path: folder.path, reason: 'attach-failed' });
    }

    for (const img of payload.osImageFiles) {
      const ok = await this.deps.imageContext.addImageFromFile(img, 'drop');
      if (ok) attached.push(img.name);
      else rejected.push({ path: img.name, reason: 'image-failed' });
    }

    const vaultPath = this.deps.getVaultPath();
    const externalRoots = this.deps.getExternalContexts();

    for (const file of payload.osFiles) {
      const absolutePath = getFilePath(file) ?? file.name;
      const classified = classifyOsPath(absolutePath, vaultPath, externalRoots, { isDirectory: false });
      switch (classified.kind) {
        case 'vault-file':
          if (this.deps.fileContext.attachFileAsPill(classified.relPath)) attached.push(classified.relPath);
          else rejected.push({ path: absolutePath, reason: 'attach-failed' });
          break;
        case 'external-file':
          if (this.deps.fileContext.attachExternalContextMention(absolutePath)) attached.push(absolutePath);
          else rejected.push({ path: absolutePath, reason: 'attach-failed' });
          break;
        case 'rejected':
          rejected.push({ path: absolutePath, reason: 'outside-context' });
          break;
        default:
          // Unreachable: isDirectory:false rules out vault-folder/external-folder.
          // Kept for exhaustiveness across the shared OsPathClassification union.
          rejected.push({ path: absolutePath, reason: 'outside-context' });
          break;
      }
    }

    for (const folder of payload.osFolders) {
      const classified = classifyOsPath(folder.path, vaultPath, externalRoots, { isDirectory: true });
      switch (classified.kind) {
        case 'vault-folder':
          if (this.deps.fileContext.attachFolderAsPill(classified.relPath)) attached.push(classified.relPath);
          else rejected.push({ path: folder.path, reason: 'attach-failed' });
          break;
        case 'external-folder':
          rejected.push({ path: folder.path, reason: 'external-folder-unsupported' });
          break;
        case 'rejected':
          rejected.push({ path: folder.path, reason: 'outside-context' });
          break;
        default:
          // Unreachable: isDirectory:true rules out vault-file/external-file.
          // Kept for exhaustiveness across the shared OsPathClassification union.
          rejected.push({ path: folder.path, reason: 'outside-context' });
          break;
      }
    }

    this.fireNotices(attached.length, rejected);
    this.deps.inputEl.focus();
  }

  private fireNotices(
    attachedCount: number,
    rejected: Array<{ path: string; reason: string }>
  ): void {
    if (attachedCount > 0) {
      new Notice(t('chat.drop.batchAdded', { count: attachedCount }));
    }
    if (rejected.length === 0) return;

    const externalFolders = rejected.filter((r) => r.reason === 'external-folder-unsupported');
    const outside = rejected.filter((r) => r.reason === 'outside-context');
    const imageFailed = rejected.filter((r) => r.reason === 'image-failed');
    const attachFailed = rejected.filter((r) => r.reason === 'attach-failed');

    if (externalFolders.length > 0) {
      new Notice(t('chat.drop.externalFolderUnsupported'));
    }
    if (outside.length === 1) {
      new Notice(t('chat.drop.outsideContext', { path: outside[0].path }));
    } else if (outside.length > 1) {
      new Notice(t('chat.drop.outsideContextBatch', { count: outside.length }));
    }
    if (imageFailed.length > 0) {
      new Notice(t('chat.drop.imageFailed', { count: imageFailed.length }));
    }
    if (attachFailed.length > 0) {
      new Notice(t('chat.drop.batchSkipped', { count: attachFailed.length }));
    }
  }

  destroy(): void {
    if (this.inputWrapperEl) {
      for (const { type, handler } of this.listeners) {
        this.inputWrapperEl.removeEventListener(type, handler);
      }
    }
    this.listeners = [];
    this.overlayEl?.remove();
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
