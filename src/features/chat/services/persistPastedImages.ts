import type { App, TFile } from 'obsidian';

import { logger } from '../../../core/logging/Logger';
import type { ImageAttachment, ImageMediaType } from '../../../core/types';

const MEDIA_TYPE_TO_EXT: Record<ImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface PersistPastedImagesOptions {
  /** Injection point for tests; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Mutates each `ImageAttachment` in `images` whose `path` is unset by writing
 * the base64 buffer to the vault via Obsidian's attachment APIs. Respects the
 * user's "Default location for new attachments" setting through
 * `fileManager.getAvailablePathForAttachment`. Filename matches Obsidian's
 * native paste convention: `Pasted image YYYYMMDDHHmmss.<ext>`.
 *
 * Writes are sequential so two same-second pastes get disambiguated by
 * `getAvailablePathForAttachment` rather than racing on the same stamp.
 *
 * On individual write failure, the image is left with `path` undefined; the
 * caller can still send the in-memory `data`. Other images continue.
 */
export async function persistPastedImages(
  app: App,
  images: ImageAttachment[],
  options: PersistPastedImagesOptions = {},
): Promise<void> {
  if (!images || images.length === 0) return;
  const now = options.now ?? new Date();

  for (const image of images) {
    if (image.path) continue;
    const ext = MEDIA_TYPE_TO_EXT[image.mediaType];
    if (!ext) continue;
    const desired = `Pasted image ${formatPastedStamp(now)}.${ext}`;
    try {
      const targetPath = await app.fileManager.getAvailablePathForAttachment(desired);
      const buffer = Buffer.from(image.data, 'base64');
      const tFile: TFile = await app.vault.createBinary(targetPath, buffer);
      image.path = tFile.path;
      image.name = tFile.name;
    } catch (err) {
      logger.warn('persistPastedImages: failed to write image to vault', { id: image.id, error: err });
    }
  }
}

function formatPastedStamp(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}
