/**
 * Full-size image modal overlay, shared between the message-list image viewer
 * ({@link MessageRenderer.showFullImage}) and the composer image-preview viewer
 * ({@link ImageContextManager}). Both built identical overlay chrome — backdrop,
 * centered image, close button, Escape + click-outside dismissal — differing only
 * in how the image `src` is resolved, so callers pass the already-resolved `src`.
 *
 * `ownerDocument` is supplied so the overlay mounts in the same document as the
 * triggering element (Obsidian popout windows) rather than always the global one.
 */
export function openImageModal(params: {
  ownerDocument: Document;
  src: string;
  alt?: string;
}): void {
  const { ownerDocument, src, alt } = params;

  const overlay = ownerDocument.body.createDiv({ cls: 'specorator-image-modal-overlay' });
  const modal = overlay.createDiv({ cls: 'specorator-image-modal' });

  modal.createEl('img', {
    attr: { src, ...(alt !== undefined ? { alt } : {}) },
  });

  const closeBtn = modal.createDiv({ cls: 'specorator-image-modal-close' });
  closeBtn.setText('×');

  const handleEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    ownerDocument.removeEventListener('keydown', handleEsc);
    overlay.remove();
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  ownerDocument.addEventListener('keydown', handleEsc);
}
