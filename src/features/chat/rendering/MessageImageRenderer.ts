import { type App, Notice } from 'obsidian';

import type { ImageAttachment } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { getVaultFileByPath } from '../../../utils/obsidianCompat';
import { openImageModal } from '../ui/imageModal';

/**
 * App + owner-document escapes the image renderer reads from the owning
 * {@link MessageRenderer}; `getOwnerDocument` is live so it follows
 * `setMessagesEl` re-parents.
 */
export interface MessageImageRendererDeps {
  readonly app: App;
  getOwnerDocument(): Document;
}

/**
 * Resolves and renders message image attachments (vault resource path or
 * base64 fallback) plus the full-size modal. Extracted from `MessageRenderer`
 * so the orchestrator delegates the attachment-source resolution and image DOM.
 */
export class MessageImageRenderer {
  constructor(private readonly deps: MessageImageRendererDeps) {}

  /**
   * Returns the best <img src> for an attachment: vault resource path when the
   * file exists, base64 data URI otherwise, null if neither is usable.
   */
  private resolveImageSrc(image: ImageAttachment): string | null {
    if (image.path) {
      const file = getVaultFileByPath(this.deps.app, image.path);
      if (file) return this.deps.app.vault.getResourcePath(file);
    }
    if (image.data) return `data:${image.mediaType};base64,${image.data}`;
    return null;
  }

  /**
   * Sets image src from attachment — prefers vault file over base64 blob.
   */
  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    const src = this.resolveImageSrc(image);
    if (src) {
      imgEl.setAttribute('src', src);
    }
  }

  /**
   * Renders image attachments above a message.
   */
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = containerEl.createDiv({ cls: 'claudian-message-images' });

    for (const image of images) {
      const src = this.resolveImageSrc(image);
      if (!src) {
        const fallback = imagesEl.createDiv({ cls: 'claudian-message-image-fallback' });
        fallback.setText(image.name || 'image');
        continue;
      }

      const imageWrapper = imagesEl.createDiv({ cls: 'claudian-message-image' });
      const imgEl = imageWrapper.createEl('img', {
        attr: {
          alt: image.name,
          loading: 'lazy',
          decoding: 'async',
        },
      });
      imgEl.setAttribute('src', src);

      imgEl.addEventListener('click', () => {
        void this.showFullImage(image);
      });
    }
  }

  /**
   * Shows full-size image in modal overlay.
   */
  showFullImage(image: ImageAttachment): void {
    const src = this.resolveImageSrc(image);
    if (!src) {
      // Nothing to show — surface a brief fallback rather than a blank modal.
      new Notice(t('chat.image.unavailable'));
      return;
    }

    const ownerDocument = this.deps.getOwnerDocument();
    openImageModal({ ownerDocument, src, alt: image.name });
  }
}
