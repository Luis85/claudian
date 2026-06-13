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
import { classifyOsPath, type OsPathClassification } from './osPathClassification';

type ClassifiedOsPath = OsPathClassification;

type RejectionReason = 'attach-failed' | 'image-failed' | 'outside-context' | 'external-folder-unsupported';

interface DropSink {
  attached: string[];
  rejected: Array<{ path: string; reason: RejectionReason }>;
}

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

    const sink: DropSink = { attached: [], rejected: [] };

    this.routeVaultPayload(payload, sink);
    // The OS-image loop is awaited inline (not delegated to an async method)
    // so handleDrop's microtask budget matches the single awaited hop callers
    // and tests rely on — wrapping it in an extra `async` method delays the
    // synchronous routeOsPaths/fireNotices past one microtask turn.
    for (const img of payload.osImageFiles) {
      const ok = await this.deps.imageContext.addImageFromFile(img, 'drop');
      if (ok) sink.attached.push(img.name);
      else sink.rejected.push({ path: img.name, reason: 'image-failed' });
    }
    this.routeOsPaths(payload, sink);

    this.fireNotices(sink.attached.length, sink.rejected);
    this.deps.inputEl.focus();
  }

  private routeVaultPayload(payload: DroppedPayload, sink: DropSink): void {
    for (const file of payload.vaultFiles) {
      if (this.deps.fileContext.attachFileAsPill(file.path)) sink.attached.push(file.path);
      else sink.rejected.push({ path: file.path, reason: 'attach-failed' });
    }

    for (const folder of payload.vaultFolders) {
      if (this.deps.fileContext.attachFolderAsPill(folder.path)) sink.attached.push(folder.path);
      else sink.rejected.push({ path: folder.path, reason: 'attach-failed' });
    }
  }

  private routeOsPaths(payload: DroppedPayload, sink: DropSink): void {
    const vaultPath = this.deps.getVaultPath();
    const externalRoots = this.deps.getExternalContexts();

    for (const file of payload.osFiles) {
      const absolutePath = getFilePath(file) ?? file.name;
      const classified = classifyOsPath(absolutePath, vaultPath, externalRoots, { isDirectory: false });
      this.applyClassifiedOsFile(absolutePath, classified, sink);
    }

    for (const folder of payload.osFolders) {
      const classified = classifyOsPath(folder.path, vaultPath, externalRoots, { isDirectory: true });
      this.applyClassifiedOsFolder(folder.path, classified, sink);
    }
  }

  private applyClassifiedOsFile(absolutePath: string, classified: ClassifiedOsPath, sink: DropSink): void {
    switch (classified.kind) {
      case 'vault-file':
        if (this.deps.fileContext.attachFileAsPill(classified.relPath)) sink.attached.push(classified.relPath);
        else sink.rejected.push({ path: absolutePath, reason: 'attach-failed' });
        break;
      case 'external-file':
        if (this.deps.fileContext.attachExternalContextMention(absolutePath)) sink.attached.push(absolutePath);
        else sink.rejected.push({ path: absolutePath, reason: 'attach-failed' });
        break;
      default:
        // 'rejected' plus the unreachable folder kinds (isDirectory:false rules
        // them out) collapse to outside-context for exhaustiveness.
        sink.rejected.push({ path: absolutePath, reason: 'outside-context' });
        break;
    }
  }

  private applyClassifiedOsFolder(folderPath: string, classified: ClassifiedOsPath, sink: DropSink): void {
    switch (classified.kind) {
      case 'vault-folder':
        if (this.deps.fileContext.attachFolderAsPill(classified.relPath)) sink.attached.push(classified.relPath);
        else sink.rejected.push({ path: folderPath, reason: 'attach-failed' });
        break;
      case 'external-folder':
        sink.rejected.push({ path: folderPath, reason: 'external-folder-unsupported' });
        break;
      default:
        // 'rejected' plus the unreachable file kinds (isDirectory:true rules
        // them out) collapse to outside-context for exhaustiveness.
        sink.rejected.push({ path: folderPath, reason: 'outside-context' });
        break;
    }
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
