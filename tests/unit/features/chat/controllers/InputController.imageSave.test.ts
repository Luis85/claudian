import type { App } from 'obsidian';

import type { ImageAttachment } from '@/core/types';
import { persistPastedImages } from '@/features/chat/services/persistPastedImages';

jest.mock('@/features/chat/services/persistPastedImages', () => ({
  persistPastedImages: jest.fn(async (_app: App, images: ImageAttachment[]) => {
    for (const img of images) {
      if (!img.path) {
        img.path = `attachments/${img.name}`;
      }
    }
  }),
}));

describe('InputController image save integration', () => {
  beforeEach(() => {
    (persistPastedImages as jest.Mock).mockClear();
  });

  it('calls persistPastedImages before building the turn submission', async () => {
    const { dispatchSendForTest } = await import('./_fixtures/sendImageFixture');
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'clipboard.png',
      mediaType: 'image/png',
      data: Buffer.from('hello').toString('base64'),
      size: 5,
      source: 'paste',
    };

    const { messageImages, turnRequestImages } = await dispatchSendForTest({ images: [image] });

    expect(persistPastedImages).toHaveBeenCalledTimes(1);
    expect(messageImages?.[0].path).toBe('attachments/clipboard.png');
    expect(turnRequestImages?.[0].path).toBe('attachments/clipboard.png');
    expect(turnRequestImages?.[0].data).toBe(image.data); // data still present for runtime
  });

  it('skips images that already have a path (re-send / queued from prior turn)', async () => {
    const { dispatchSendForTest } = await import('./_fixtures/sendImageFixture');
    const image: ImageAttachment = {
      id: 'img-2',
      name: 'existing.png',
      mediaType: 'image/png',
      data: Buffer.from('x').toString('base64'),
      size: 1,
      source: 'paste',
      path: 'attachments/existing.png',
    };
    const result = await dispatchSendForTest({ images: [image] });

    expect(persistPastedImages).toHaveBeenCalledTimes(1);
    expect(result.messageImages?.[0].path).toBe('attachments/existing.png');
  });

  // M-02 regression — the queue/streaming branch must also see persisted images.
  // Before the fix, `persistPastedImages` ran AFTER the `if (state.isStreaming)`
  // check, so queued + steered turns could land in ConversationStore.save with
  // `data` cleared and no `path`. Now persist is hoisted above the queue branch.
  it('persists images before snapshotting the queued message (queue branch)', async () => {
    const { dispatchQueuedSendForTest } = await import('./_fixtures/sendImageFixture');
    const image: ImageAttachment = {
      id: 'img-3',
      name: 'queued.png',
      mediaType: 'image/png',
      data: Buffer.from('queued').toString('base64'),
      size: 6,
      source: 'paste',
    };

    const { queuedImages, queuedTurnRequestImages } = await dispatchQueuedSendForTest({
      images: [image],
    });

    expect(persistPastedImages).toHaveBeenCalledTimes(1);
    // path stamped on the same ref before the queue snapshot captured it
    expect(queuedImages?.[0].path).toBe('attachments/queued.png');
    expect(queuedTurnRequestImages?.[0].path).toBe('attachments/queued.png');
    // data still present for runtime consumption when the turn eventually flushes
    expect(queuedTurnRequestImages?.[0].data).toBe(image.data);
  });
});
