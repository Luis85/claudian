import type { App } from 'obsidian';

import type { ChatMessage, ImageAttachment } from '@/core/types';
import { persistPastedImages } from '@/features/chat/services/persistPastedImages';

/**
 * Mirrors the relevant block of InputController.send so the wiring of
 * persistPastedImages can be exercised in isolation. Keep in sync with
 * InputController.send: collect images → persist → build snapshot + request.
 */
export async function dispatchSendForTest(input: {
  images: ImageAttachment[];
}): Promise<{
  messageImages?: ImageAttachment[];
  turnRequestImages?: ImageAttachment[];
}> {
  const app = {} as App;
  const images = input.images;
  await persistPastedImages(app, images);
  const imagesForMessage = images.length > 0 ? [...images] : undefined;
  const message: ChatMessage = {
    id: 'm1',
    role: 'user',
    content: 'hi',
    timestamp: 0,
    images: imagesForMessage,
  };
  const turnRequest: { images?: ImageAttachment[] } = {
    images: imagesForMessage ? [...imagesForMessage] : undefined,
  };
  return {
    messageImages: message.images,
    turnRequestImages: turnRequest.images,
  };
}

/**
 * Mirrors the streaming-queue branch of InputController.send: persistPastedImages
 * runs FIRST, then the queue snapshot is captured from the same image refs. The
 * order matters — moved the persist call above the `if (state.isStreaming)` check
 * so queued (and later steered) images carry `path` into ConversationStore.save.
 */
export async function dispatchQueuedSendForTest(input: {
  images: ImageAttachment[];
}): Promise<{
  queuedImages?: ImageAttachment[];
  queuedTurnRequestImages?: ImageAttachment[];
}> {
  const app = {} as App;
  const images = input.images;
  // Hoisted persist (matches InputController.send: runs before the queue branch).
  await persistPastedImages(app, images);
  // Queue branch: spread snapshot into queuedMessage; turnRequest references same refs.
  const queuedImages = images.length > 0 ? [...images] : undefined;
  const turnRequest: { images?: ImageAttachment[] } = {
    images: queuedImages ? [...queuedImages] : undefined,
  };
  return {
    queuedImages,
    queuedTurnRequestImages: turnRequest.images,
  };
}
